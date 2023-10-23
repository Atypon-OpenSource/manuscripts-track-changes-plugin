/*!
 * © 2021 Atypon Systems LLC
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
import { CHANGE_STATUS, TrackedAttrs, TrackedChange } from '../types/change'
import { log } from '../utils/logger'
import { deleteNode } from '../mutate/deleteNode'
import { mergeNode } from '../mutate/mergeNode'
import { updateChangeChildrenAttributes } from './updateChangeAttrs'

function getUpdatedDataTracked(dataTracked: TrackedAttrs[] | null, changeId: string) {
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
 * @param deleteMap
 */
export function applyAcceptedRejectedChanges(
  tr: Transaction,
  schema: Schema,
  changes: TrackedChange[],
  deleteMap = new Mapping()
): Mapping {
  const attrsChangesLog = new Map<string, string[]>() // map of node ids and applied change updatedAt timestamp
  function addAttrLog(nodeId: string, changeId: string) {
    const arr = attrsChangesLog.get(nodeId) || attrsChangesLog.set(nodeId, []).get(nodeId)
    arr!.push(changeId)
  }

  changes.forEach((change) => {
    // Map change.from and skip those which dont need to be applied
    // or were already deleted by an applied block delete
    const { pos: from, deleted } = deleteMap.mapResult(change.from),
      node = tr.doc.nodeAt(from),
      noChangeNeeded = deleted || !ChangeSet.shouldDeleteChange(change)
    if (!node) {
      !deleted && log.warn('no node found to update for change', change)
      return
    }

    if (change.dataTracked.status === CHANGE_STATUS.pending) {
      if (ChangeSet.isNodeAttrChange(change)) {
        /*
          Apply pending changes for attributes as well because applying accepted/rejected changes may override
          pending because we store the most recent change directly on the node attributes. But in case of pending attributes
          we don't need to remove dataTracked record. We need, however, to make sure we don't restore dataTracked records for
          the previously applied changes. To check for already applied changes we log them into "attrsChangesLog" Map.
        */
        const { dataTracked, ...attrs } = change.newAttrs
        const changeLog = attrsChangesLog.get(node.attrs.id)
        const newDataTracked =
          changeLog && changeLog.length ? (dataTracked as TrackedAttrs[]).filter((c) => !changeLog.includes(c.id)) : dataTracked
        tr.setNodeMarkup(from, undefined, { ...attrs, dataTracked: newDataTracked.length ? newDataTracked : null }, node.marks)
        // default is "null" for dataTracked in attrs in pm schema, so codebase generally relies on it being null when empty
      }
      return
    }

    if (ChangeSet.isTextChange(change) && noChangeNeeded) {
      tr.removeMark(from, deleteMap.map(change.to), schema.marks.tracked_insert)
      tr.removeMark(from, deleteMap.map(change.to), schema.marks.tracked_delete)
    } else if (ChangeSet.isTextChange(change)) {
      tr.delete(from, deleteMap.map(change.to))
      deleteMap.appendMap(tr.steps[tr.steps.length - 1].getMap())
    } else if (ChangeSet.isNodeChange(change) && noChangeNeeded) {
      const attrs = { ...node.attrs, dataTracked: null }
      tr.setNodeMarkup(from, undefined, attrs, node.marks)
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
        { ...change.newAttrs, dataTracked: getUpdatedDataTracked(node.attrs.dataTracked, change.id) },
        node.marks
      )
      addAttrLog(node.attrs.id, change.dataTracked.id)
    } else if (ChangeSet.isNodeAttrChange(change) && change.dataTracked.status === CHANGE_STATUS.rejected) {
      tr.setNodeMarkup(
        from,
        undefined,
        { ...change.oldAttrs, dataTracked: getUpdatedDataTracked(node.attrs.dataTracked, change.id) },
        node.marks
      )
      addAttrLog(node.attrs.id, change.dataTracked.id)
    }
  })
  return deleteMap
}
