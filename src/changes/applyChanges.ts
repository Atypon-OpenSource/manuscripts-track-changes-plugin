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
import { Schema } from 'prosemirror-model'
import { Transaction } from 'prosemirror-state'
import { Mapping } from 'prosemirror-transform'

import { ChangeSet } from '../ChangeSet'
import { deleteNode, keepDeleteWithMoveNodeId } from '../mutate/deleteNode'
import { dropOrphanChanges, unCoverShadow } from '../mutate/dropStructureChange'
import { mergeNode } from '../mutate/mergeNode'
import { CHANGE_OPERATION, CHANGE_STATUS, TrackedAttrs, TrackedChange } from '../types/change'
import { log } from '../utils/logger'
import { revertSplitNodeChange, revertWrapNodeChange } from './revertChange'
import { updateChangeChildrenAttributes } from './updateChangeAttrs'

export function getUpdatedDataTracked(dataTracked: TrackedAttrs[] | null, changeId: string) {
  if (!dataTracked) {
    return null
  }
  const newDataTracked = dataTracked.filter((c) => c.id !== changeId)
  return newDataTracked.length ? newDataTracked : null
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
    if (
      change.dataTracked.operation === CHANGE_OPERATION.move ||
      change.dataTracked.operation === CHANGE_OPERATION.structure
    ) {
      return
    }
    // Map change.from and skip those which don't need to be applied
    // or were already deleted by an applied block delete
    const { pos: from, deleted } = deleteMap.mapResult(change.from)
    const node = tr.doc.nodeAt(from)
    const noChangeNeeded = !ChangeSet.shouldDeleteChange(change)
    if (deleted) {
      unCoverShadow(change.dataTracked.moveNodeId, tr)
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
      const attrs = { ...node.attrs, dataTracked: keepDeleteWithMoveNodeId(node) }
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
      dropOrphanChanges(tr)
    } else if (ChangeSet.isNodeAttrChange(change) && change.dataTracked.status === CHANGE_STATUS.accepted) {
      tr.setNodeMarkup(
        from,
        undefined,
        {
          ...change.newAttrs,
          dataTracked: getUpdatedDataTracked(node.attrs.dataTracked, change.id),
        },
        node.marks
      )
    } else if (ChangeSet.isNodeAttrChange(change) && change.dataTracked.status === CHANGE_STATUS.rejected) {
      tr.setNodeMarkup(
        from,
        undefined,
        {
          ...change.oldAttrs,
          dataTracked: getUpdatedDataTracked(node.attrs.dataTracked, change.id),
        },
        node.marks
      )
    } else if (ChangeSet.isReferenceChange(change)) {
      tr.setNodeMarkup(
        from,
        undefined,
        { ...node.attrs, dataTracked: getUpdatedDataTracked(node.attrs.dataTracked, change.id) },
        node.marks
      )
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
      unCoverShadow(change.dataTracked.moveNodeId, tr)
      return
    }

    if (change.dataTracked.status === CHANGE_STATUS.accepted) {
      // Remove tracking from the moved node (new position)
      const attrs = {
        ...node.attrs,
        dataTracked: getUpdatedDataTracked(node.attrs.dataTracked, change.id),
      }
      tr.setNodeMarkup(from, undefined, attrs, node.marks)

      // Find the original delete for move or structure changes
      changeSet.changes
        .filter(
          (c) =>
            c.dataTracked.moveNodeId === change.dataTracked.moveNodeId &&
            c.dataTracked.operation === CHANGE_OPERATION.delete
        )
        .map((originalChange) => {
          if (originalChange) {
            const { pos: originalFrom, deleted } = deleteMap.mapResult(originalChange.from)
            const originalNode = tr.doc.nodeAt(originalFrom)
            // Delete the original node (old position)
            if (originalNode && !deleted) {
              tr.delete(originalFrom, originalFrom + originalNode.nodeSize)
              deleteMap.appendMap(tr.steps[tr.steps.length - 1].getMap())
            }
          } else {
            log.warn('No original change found for move operation', { change })
          }
        })
    } else if (change.dataTracked.status === CHANGE_STATUS.rejected) {
      // For rejected moves, delete the moved node (new position)
      tr.delete(from, from + node.nodeSize)
      deleteMap.appendMap(tr.steps[tr.steps.length - 1].getMap())
    }
  })

  return deleteMap
}
