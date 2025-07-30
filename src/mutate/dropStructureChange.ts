/*!
 * © 2025 Atypon Systems LLC
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
import { EditorState, Transaction } from 'prosemirror-state'
import { Mapping, ReplaceStep } from 'prosemirror-transform'

import { findChanges } from '../changes/findChanges'
import { updateChangeAttrs } from '../changes/updateChangeAttrs'
import { getBlockInlineTrackedData } from '../compute/nodeHelpers'
import { setFragmentAsInserted } from '../compute/setFragmentAsInserted'
import { CHANGE_OPERATION, CHANGE_STATUS, NodeChange } from '../types/change'
import { NewEmptyAttrs } from '../types/track'
import { createNewInsertAttrs, updateBlockNodesAttrs } from '../utils/track-utils'

/** remove the copy of structure change that was set as delete with moveNodeId */
export const dropStructuralChangeShadow = (
  moveNodeId: string | undefined,
  tr: Transaction,
  mapping?: Mapping
) => {
  const changeSet = findChanges(EditorState.create({ doc: tr.doc }))
  const changes = changeSet.changes.filter(
    (c) => c.type === 'node-change' && c.dataTracked.moveNodeId === moveNodeId
  )
  const shadow = changes.filter((c) => c.dataTracked.operation === CHANGE_OPERATION.delete)
  if (shadow.length > 0) {
    tr.delete(shadow[0].from, shadow[shadow.length - 1].to)
    mapping?.appendMap(tr.steps[tr.steps.length - 1].getMap())
  }
  return tr
}

export const unCoverShadow = (moveNodeId: string | undefined, tr: Transaction) => {
  const changeSet = findChanges(EditorState.create({ doc: tr.doc }))
  const shadows = changeSet.changes.filter(
    (c) =>
      c.dataTracked.operation === CHANGE_OPERATION.delete &&
      c.dataTracked.moveNodeId &&
      moveNodeId === c.dataTracked.moveNodeId
  )
  shadows.map((c) =>
    updateChangeAttrs(tr, c, { ...c.dataTracked, status: CHANGE_STATUS.rejected }, tr.doc.type.schema)
  )
}

/** convert to insert change structure and move change that has no delete change linked to it by moveNodId */
export const dropOrphanChanges = (newTr: Transaction) => {
  const changeSet = findChanges(EditorState.create({ doc: newTr.doc }))
  const moveNodeIds = new Set(
    changeSet.changes
      .filter((c) => c.dataTracked.moveNodeId && c.dataTracked.operation === CHANGE_OPERATION.delete)
      .map((c) => c.dataTracked.moveNodeId)
  )
  const orphanChanges = changeSet.changes.filter(
    (c) =>
      (c.dataTracked.operation === CHANGE_OPERATION.structure ||
        c.dataTracked.operation === CHANGE_OPERATION.move) &&
      !moveNodeIds.has(c.dataTracked.moveNodeId)
  ) as NodeChange[]
  if (!orphanChanges.length) {
    return
  }

  orphanChanges.forEach((c) => {
    let attrs = { ...c.dataTracked, operation: CHANGE_OPERATION.insert }
    delete attrs.moveNodeId
    newTr.replaceWith(
      c.from,
      c.to,
      setFragmentAsInserted(Fragment.from(c.node), createNewInsertAttrs(attrs), newTr.doc.type.schema)
    )
  })
}

const groupStructureChanges = (tr: Transaction, toNode: PMNode | null) => {
  const moveNodeIds = new Set<string>()
  const [insertStep, deleteStep] = tr.steps as ReplaceStep[]
  const fromNodes = tr.docs[1].slice(deleteStep.from, deleteStep.to).content
  const ignoredNode = tr.docs[1].nodeAt(deleteStep.from)

  Fragment.from(toNode)
    .append(insertStep.slice.content)
    .append(fromNodes)
    .descendants((node) => {
      const moveNodeId = (getBlockInlineTrackedData(node) || []).find(
        (c) => c.operation === CHANGE_OPERATION.structure
      )?.moveNodeId
      moveNodeId && moveNodeIds.add(moveNodeId)
    })

  return moveNodeIds
}

/** will join other structural changes in the range of transaction steps
 * that join will be for both structure change and delete shadow */
export const joinStructureChanges = (
  attrs: NewEmptyAttrs,
  sliceContent: Fragment,
  content: Fragment,
  tr: Transaction,
  newTr: Transaction
) => {
  const moveNodeId = attrs.moveNodeId
  let toNode: PMNode | null = tr.docs[0].resolve((tr.steps[0] as ReplaceStep).from).node()
  // this to make sure we don't pick a doc,body,abstract nodes
  toNode = toNode?.type.spec.attrs?.dataTracked ? toNode : null

  const idsSet = groupStructureChanges(tr, toNode)
  const changeSet = findChanges(EditorState.create({ doc: newTr.doc }))

  const structuralChanges = changeSet.changes.filter(
    (c) =>
      c.dataTracked.operation === CHANGE_OPERATION.delete ||
      (c.dataTracked.operation === CHANGE_OPERATION.structure &&
        c.dataTracked.moveNodeId &&
        idsSet.has(c.dataTracked.moveNodeId))
  )
  structuralChanges.map((c) =>
    updateChangeAttrs(newTr, c, { ...c.dataTracked, moveNodeId }, newTr.doc.type.schema)
  )

  const toInsertChange =
    toNode && getBlockInlineTrackedData(toNode)?.find((c) => c.operation === CHANGE_OPERATION.insert)
  const fromInsertChange =
    sliceContent.firstChild &&
    getBlockInlineTrackedData(sliceContent.firstChild)?.find((c) => c.operation === CHANGE_OPERATION.insert)
  if (toInsertChange || fromInsertChange) {
    // when moving structure change to a parent node that is insert or if the change itself is insert will keep it as insert
    return setFragmentAsInserted(content, createNewInsertAttrs(attrs), newTr.doc.type.schema)
  }

  return updateBlockNodesAttrs(content, (attrs, node) => {
    const dataTracked = getBlockInlineTrackedData(node)?.map((c) =>
      c.operation == CHANGE_OPERATION.structure ? { ...c, moveNodeId } : c
    )
    return { ...attrs, dataTracked }
  })
}
