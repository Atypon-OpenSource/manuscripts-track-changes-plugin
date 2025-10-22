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
import { Fragment, Node as PMNode } from 'prosemirror-model'
import { Transaction } from 'prosemirror-state'

import { dropStructuralChangeShadow } from './structureChange'
import { log } from '../../utils/logger'
import { addTrackIdIfDoesntExist, getBlockInlineTrackedData, NewDeleteAttrs } from '../../attributes'
import { CHANGE_OPERATION, CHANGE_STATUS } from '../../types/change'

/**
 * Deletes node but tries to leave its content intact by trying to unwrap it first
 *
 * Incase unwrapping doesn't work deletes the whole node.
 * @param node
 * @param pos
 * @param tr
 * @returns
 */
export function deleteNode(node: PMNode, pos: number, tr: Transaction) {
  const resPos = tr.doc.resolve(pos)
  // Block nodes can be deleted by just removing their start token which should then merge the text
  // content to above node's content (if there is one)
  // this will work just for the node after the first child
  const canMergeToNodeAbove =
    resPos.parent !== tr.doc && resPos.nodeBefore && node.isBlock && node.firstChild?.isText
  if (canMergeToNodeAbove) {
    return tr.replaceWith(pos - 1, pos + 1, Fragment.empty)
  } else {
    // NOTE: there's an edge case where moving content is not possible but because the immediate
    // child, say some wrapper blockNode, is also deleted the content could be retained. TODO I guess.
    return tr.delete(pos, pos + node.nodeSize)
  }
}

/**
 * Deletes inserted block or inline node, otherwise adds `dataTracked` object with CHANGE_STATUS 'deleted'
 * @param node
 * @param pos
 * @param newTr
 * @param deleteAttrs
 */
export function deleteOrSetNodeDeleted(
  node: PMNode,
  pos: number,
  newTr: Transaction,
  deleteAttrs: NewDeleteAttrs
) {
  const dataTracked = getBlockInlineTrackedData(node)
  const inserted = dataTracked?.find(
    (d) =>
      (d.operation === CHANGE_OPERATION.insert || d.operation === CHANGE_OPERATION.wrap_with_node) &&
      (d.status === CHANGE_STATUS.pending || d.status === CHANGE_STATUS.accepted)
  )
  const updated = dataTracked?.find(
    (d) =>
      d.operation === CHANGE_OPERATION.set_node_attributes ||
      d.operation === CHANGE_OPERATION.reference ||
      (d.operation === CHANGE_OPERATION.delete && d.moveNodeId)
  )
  const structure = dataTracked?.find((c) => c.operation === CHANGE_OPERATION.structure)
  // that will remove next change shadow of structure change node
  if (deleteAttrs.moveNodeId && structure && structure.moveNodeId !== deleteAttrs.moveNodeId) {
    return newTr.delete(pos, pos + node.nodeSize)
  }

  const moved = dataTracked?.find(
    (d) => d.operation === CHANGE_OPERATION.move && d.status === CHANGE_STATUS.pending
  )
  /*
    Removed condition "inserted.authorID === deleteAttrs.authorID" for this check because it resulted in a weird behaviour of deletion of approved changes
    Approved changes handling are in the process of revision at the time of writing this comment.
  */
  if (inserted) {
    return deleteNode(node, pos, newTr)
  }
  if (!newTr.doc.nodeAt(pos)) {
    log.error(`deleteOrSetNodeDeleted: no node found for deletion`, {
      pos,
      node,
      newTr,
    })
    return
  }
  const newDeleted = addTrackIdIfDoesntExist(deleteAttrs)
  newTr.setNodeMarkup(
    pos,
    undefined,
    {
      ...node.attrs,
      dataTracked: updated ? [newDeleted, updated] : moved ? [newDeleted, moved] : [newDeleted],
    },
    node.marks
  )

  if (!deleteAttrs.moveNodeId && structure?.moveNodeId) {
    dropStructuralChangeShadow(structure.moveNodeId, newTr)
  }
}
/**
 * Keep change that is paired with other changes, like:
 * delete change with moveNodeId as it should be hidden
 * reference change of node split
 */
export const keepPairedChanges = (node: PMNode) => {
  const dataTracked = getBlockInlineTrackedData(node)?.filter(
    (c) =>
      (c.operation === CHANGE_OPERATION.delete && c.moveNodeId) || c.operation === CHANGE_OPERATION.reference
  )
  return dataTracked?.length ? dataTracked : null
}
