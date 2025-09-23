/*!
 * © 2023 Atypon Systems LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { ManuscriptNode } from '@manuscripts/transform'
import { Schema } from 'prosemirror-model'
import { Transaction } from 'prosemirror-state'
import { Mapping } from 'prosemirror-transform'

import { ChangeSet } from '../ChangeSet'
import { deleteNode, keepPairedChanges } from '../mutate/deleteNode'
import { mergeNode } from '../mutate/mergeNode'
import { CHANGE_OPERATION, CHANGE_STATUS, MarkChange, TrackedAttrs, TrackedChange } from '../types/change'
import { log } from '../utils/logger'
import { excludeFromTracked, isInlineMarkChange } from '../utils/track-utils'
import { revertSplitNodeChange, revertWrapNodeChange } from './revertChange'
import { restoreNode, updateChangeChildrenAttributes } from './updateChangeAttrs'

/**
 * Collects all moveNodeIds from a container node and its descendants
 */
function collectMoveNodeIds(containerNode: ManuscriptNode, primaryMoveNodeId: string): Set<string> {
  const moveNodeIds = new Set<string>()
  moveNodeIds.add(primaryMoveNodeId)

  containerNode.descendants((childNode: ManuscriptNode) => {
    const dataTracked = childNode.attrs.dataTracked
    if (Array.isArray(dataTracked)) {
      dataTracked.forEach((trackingData: { moveNodeId?: string }) => {
        if (trackingData.moveNodeId) {
          moveNodeIds.add(trackingData.moveNodeId)
        }
      })
    }
  })

  return moveNodeIds
}
/**
 * Applies the accepted/rejected changes in the current document and sets them untracked
 *
 * @param tr
 * @param schema
 * @param changes
 * @param changeSet
 * @param deleteMap
 */
export function applyAcceptedRejectedChanges(
  tr: Transaction,
  schema: Schema,
  changes: TrackedChange[],
  changeSet: ChangeSet,
  deleteMap = new Mapping()
): Mapping {
  // this will make sure that node-attr-change apply first as the editor prevent deleting node & update attribute
  changes.sort((c1, c2) => {
    // list change need to be first to lift list item then we can apply paragraph children changes
    if (
      (c1.type === 'node-change' && c1.node.type === schema.nodes.list) ||
      (c2.type === 'node-change' && c2.node.type === schema.nodes.list)
    ) {
      return 1
    }
    return c1.dataTracked.updatedAt - c2.dataTracked.updatedAt
  })

  changes.forEach((change) => {
    // Skip MOVE; full handling is in the second pass
    if (
      change.dataTracked.operation === CHANGE_OPERATION.move ||
      change.dataTracked.operation === CHANGE_OPERATION.structure
    ) {
      return
    }

    // Skip DELETE that belongs to a MOVE; full handling is in the second pass
    if (change.dataTracked.operation === CHANGE_OPERATION.delete && change.dataTracked.moveNodeId) {
      return
    }

    // Map change.from and skip those which don't need to be applied
    // or were already deleted by an applied block delete
    const { pos: from, deleted } = deleteMap.mapResult(change.from)
    const node = tr.doc.nodeAt(from)
    const noChangeNeeded = !ChangeSet.shouldDeleteChange(change)
    if (deleted) {
      // Skip if the change was already deleted
      return
    }
    if (!node) {
      !deleted && log.warn('No node found to update for change', change)
      return
    }

    if (change.dataTracked.status === CHANGE_STATUS.rejected) {
      if (change.dataTracked.operation === CHANGE_OPERATION.node_split) {
        return revertSplitNodeChange(tr, change, changeSet)
      }
      if (change.dataTracked.operation === CHANGE_OPERATION.wrap_with_node) {
        return revertWrapNodeChange(tr, change, deleteMap)
      }
    }

    if (ChangeSet.isTextChange(change) && noChangeNeeded) {
      tr.removeMark(from, deleteMap.map(change.to), schema.marks.tracked_insert)
      tr.removeMark(from, deleteMap.map(change.to), schema.marks.tracked_delete)
    } else if (ChangeSet.isTextChange(change)) {
      tr.delete(from, deleteMap.map(change.to))
      deleteMap.appendMap(tr.steps[tr.steps.length - 1].getMap())
    } else if (ChangeSet.isNodeChange(change) && noChangeNeeded) {
      const attrs = { ...node.attrs, dataTracked: keepPairedChanges(node) }
      tr.setNodeMarkup(from, undefined, attrs, node.marks)
      // If the node is an atom, remove the tracked_insert and tracked_delete marks for the direct parent node
      if (node.isAtom) {
        tr.removeMark(from, deleteMap.map(change.to), schema.marks.tracked_insert)
        tr.removeMark(from, deleteMap.map(change.to), schema.marks.tracked_delete)
      }
      updateChangeChildrenAttributes(change.children, tr, deleteMap)
    } else if (ChangeSet.isNodeChange(change)) {
      // Try first moving the node children to either nodeAbove, nodeBelow or its parent.
      // Then try unwrapping it with lift or just hacky-joining by replacing the border between
      // it and its parent with Fragment.empty. If none of these apply, delete the content between the change.
      const merged = mergeNode(node, from, tr)
      if (merged === undefined) {
        deleteNode(node, from, tr)
      }
      deleteMap.appendMap(tr.steps[tr.steps.length - 1].getMap())
    } else if (ChangeSet.isNodeAttrChange(change) && change.dataTracked.status === CHANGE_STATUS.accepted) {
      tr.setNodeMarkup(
        from,
        undefined,
        {
          ...change.newAttrs,
          dataTracked: excludeFromTracked(node.attrs.dataTracked, change.id),
        },
        node.marks
      )
    } else if (ChangeSet.isNodeAttrChange(change) && change.dataTracked.status === CHANGE_STATUS.rejected) {
      tr.setNodeMarkup(
        from,
        undefined,
        {
          ...change.oldAttrs,
          dataTracked: excludeFromTracked(node.attrs.dataTracked, change.id),
        },
        node.marks
      )
    } else if (ChangeSet.isReferenceChange(change)) {
      tr.setNodeMarkup(
        from,
        undefined,
        { ...node.attrs, dataTracked: excludeFromTracked(node.attrs.dataTracked, change.id) },
        node.marks
      )
    } else if (ChangeSet.isMarkChange(change)) {
      // marks are immutable so we need to remove a mark with dataTracked attributes and create a new one
      // if mark is marked for deletion - just delete that
      const newMark = change.mark.type.create({
        dataTracked: excludeFromTracked(change.mark.attrs.dataTracked, change.id),
      })
      const isInsert = change.dataTracked.operation === CHANGE_OPERATION.insert
      const isDelete = change.dataTracked.operation === CHANGE_OPERATION.delete

      // reinserting mark with removed dataTracked when an insertion is accepted or when deletion is rejected and we need to restore it back
      const toBeRestored =
        (change.dataTracked.status === CHANGE_STATUS.accepted && isInsert) ||
        (change.dataTracked.status === CHANGE_STATUS.rejected && isDelete)

      if (isInlineMarkChange(change)) {
        tr.removeMark(change.from, change.to, change.mark)
        if (toBeRestored) {
          tr.addMark(change.from, change.to, newMark)
        }
      } else {
        tr.removeNodeMark(change.from, change.mark)
        if (toBeRestored) {
          tr.addNodeMark(change.from, newMark)
        }
      }
    }
  })

  // Second pass: Handle move operations
  changes.forEach((change) => {
    if (
      change.dataTracked.operation !== CHANGE_OPERATION.move &&
      change.dataTracked.operation !== CHANGE_OPERATION.structure
    ) {
      return
    }

    const { pos: from, deleted } = deleteMap.mapResult(change.from)
    const node = tr.doc.nodeAt(from)

    if (deleted || !node) {
      if (!deleted && !node) {
        log.warn('No node found for move change', { change })
      }
      return
    }

    if (change.dataTracked.status === CHANGE_STATUS.accepted) {
      // Remove tracking from the moved node (new position)
      const attrs = {
        ...node.attrs,
        dataTracked: excludeFromTracked(node.attrs.dataTracked, change.id),
      }
      tr.setNodeMarkup(from, undefined, attrs, node.marks)

      // Find all the original delete changes for this move (there can be many)
      const originalChanges = changeSet.changes.filter(
        (c) =>
          c.dataTracked.moveNodeId === change.dataTracked.moveNodeId &&
          c.dataTracked.operation === CHANGE_OPERATION.delete
      )

      if (originalChanges.length === 0) {
        log.warn('No original change found for move operation', { change })
      }

      originalChanges.forEach((originalChange) => {
        const { pos: originalFrom, deleted } = deleteMap.mapResult(originalChange.from)
        if (deleted) {
          return
        }

        const originalNode = tr.doc.nodeAt(originalFrom)

        // Delete the original node (old position)
        if (originalNode) {
          tr.delete(originalFrom, originalFrom + originalNode.nodeSize)
          deleteMap.appendMap(tr.steps[tr.steps.length - 1].getMap())
        }
      })
    } else if (change.dataTracked.status === CHANGE_STATUS.rejected) {
      // Collect all moveNodeIds from the moved node and its descendants to ensure complete restoration or deletion in cases of nested moves. This prevents orphaned nodes when moves are sequential or nested.
      const moveNodeIdsToRestore = collectMoveNodeIds(node, change.dataTracked.moveNodeId!)

      // For rejected moves, delete the moved node
      tr.delete(from, from + node.nodeSize)
      deleteMap.appendMap(tr.steps[tr.steps.length - 1].getMap())

      // Restore all originals
      changeSet.changes
        .filter(
          (c) =>
            c.dataTracked.operation === CHANGE_OPERATION.delete &&
            c.dataTracked.moveNodeId &&
            moveNodeIdsToRestore.has(c.dataTracked.moveNodeId) &&
            ChangeSet.isNodeChange(c)
        )
        .forEach((orig) => {
          const { pos } = deleteMap.mapResult(orig.from)
          const node = tr.doc.nodeAt(pos)
          if (!node) {
            return
          }

          // Check if this node has been initially moved. (e.g., it was moved and then marked deleted as part of another move)
          const dataTracked = node.attrs.dataTracked || []
          const hasMoved = dataTracked.some(
            (d: TrackedAttrs) => d.operation === CHANGE_OPERATION.move && d.status === CHANGE_STATUS.pending
          )

          if (hasMoved) {
            // delete instead of restore
            tr.delete(pos, pos + node.nodeSize)
            deleteMap.appendMap(tr.steps[tr.steps.length - 1].getMap())
            return
          }

          restoreNode(tr, node, pos, schema)
        })
    }
  })

  return deleteMap
}
