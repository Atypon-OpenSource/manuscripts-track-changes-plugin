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
import { ReplaceStep } from 'prosemirror-transform'
import { TrackChangesAction } from '../actions'
import { findChanges } from '../findChanges'
import {
  getBlockInlineTrackedData,
  createNewInsertAttrs,
  NewEmptyAttrs,
  addTrackIdIfDoesntExist,
  createNewStructureAttrs,
} from '../helpers/attributes'
import { setFragmentAsInserted } from '../helpers/fragment'
import { CHANGE_OPERATION, NodeChange } from '../types/change'
import { updateBlockNodesAttrs } from '../utils/tracking'
import { updateChangeAttrs } from './updateChangeAttrs'

/** remove the copy of structure change that was set as delete with moveNodeId */
export const dropStructuralChangeShadow = (moveNodeId: string | undefined, tr: Transaction) => {
  const changeSet = findChanges(EditorState.create({ doc: tr.doc }))
  const changes = changeSet.changes.filter(
    (c) => c.type === 'node-change' && c.dataTracked.moveNodeId === moveNodeId
  )
  const shadow = changes.filter((c) => c.dataTracked.operation === CHANGE_OPERATION.delete)
  const structures = changes.filter(
    (c) => c.dataTracked.operation === CHANGE_OPERATION.structure
  ) as NodeChange[]

  structures.map((c) => {
    tr.setNodeMarkup(c.from, undefined, { ...c.node.attrs, dataTracked: null })
  })

  if (shadow.length > 0) {
    tr.delete(shadow[0].from, shadow[shadow.length - 1].to)
  }
  return tr
}

/**
 *  This function check changes that have been paired with other changes, like (structure, move, split) change
 *  - in case main change of (structure, move, split) has no connection with other paired change will convert that change to insert
 *  - or if the paired change of (delete with moveNodeId, reference) has no connection will just remove dataTracked of that change
 */
export const dropOrphanChanges = (newTr: Transaction) => {
  const changeSet = findChanges(EditorState.create({ doc: newTr.doc }))
  const shadowIds = new Set()
  const referenceIds = new Set()
  const changesIds = new Set()
  changeSet.changes.forEach((c) => {
    if (c.dataTracked.moveNodeId && c.dataTracked.operation === CHANGE_OPERATION.delete) {
      shadowIds.add(c.dataTracked.moveNodeId)
    }
    if (
      c.dataTracked.operation === CHANGE_OPERATION.structure ||
      c.dataTracked.operation === CHANGE_OPERATION.move
    ) {
      changesIds.add(c.dataTracked.moveNodeId)
    }
    if (c.dataTracked.operation === CHANGE_OPERATION.node_split) {
      changesIds.add(c.dataTracked.id)
    }
    if (c.dataTracked.operation === CHANGE_OPERATION.reference) {
      referenceIds.add(c.dataTracked.referenceId)
    }
  })

  if (!shadowIds.size && !referenceIds.size && !changesIds.size) {
    return
  }

  changeSet.changes.forEach((c) => {
    // remove reference if it's not pointing to any change
    if (
      c.dataTracked.operation === CHANGE_OPERATION.reference &&
      !changesIds.has(c.dataTracked.referenceId)
    ) {
      const node = newTr.doc.nodeAt(c.from)
      const dataTracked = node && (getBlockInlineTrackedData(node) || []).filter((d) => d.id !== c.id)
      newTr.setNodeMarkup(c.from, undefined, { ...node?.attrs, dataTracked })
    }
    if (
      c.type === 'node-change' &&
      c.dataTracked.operation === CHANGE_OPERATION.node_split &&
      !referenceIds.has(c.id)
    ) {
      const { id, ...attrs } = c.dataTracked
      newTr.replaceWith(
        c.from,
        c.to,
        setFragmentAsInserted(Fragment.from(c.node), createNewInsertAttrs(attrs), newTr.doc.type.schema)
      )
      const referenceChanges = (getBlockInlineTrackedData(c.node) || []).filter(
        (d) => d.operation === CHANGE_OPERATION.reference
      )
      // this to make sure we don't lose reference change, for the split change that has a reference for other node split
      if (referenceChanges.length) {
        const node = newTr.doc.nodeAt(c.from)
        const dataTracked = (node && getBlockInlineTrackedData(node)) || []
        newTr.setNodeMarkup(c.from, undefined, {
          ...node?.attrs,
          dataTracked: [...dataTracked, ...referenceChanges],
        })
      }
    }

    // this check if there is a connection between delete and change using moveNodeId
    if (
      c.dataTracked.moveNodeId &&
      !(shadowIds.has(c.dataTracked.moveNodeId) && changesIds.has(c.dataTracked.moveNodeId))
    ) {
      if (c.dataTracked.operation === CHANGE_OPERATION.delete) {
        if (c.type === 'text-change') {
          newTr.removeMark(c.from, c.to, newTr.doc.type.schema.marks.tracked_delete)
        } else if (c.type === 'node-change') {
          newTr.setNodeMarkup(c.from, undefined, { ...c.node.attrs, dataTracked: null })
        }
      } else if (c.type === 'node-change') {
        // if we lose connection between two changes using moveNodeId, that will be for
        // the case of removing parent node that holds shadow of other changes
        const { id, moveNodeId, ...attrs } = c.dataTracked
        newTr.replaceWith(
          c.from,
          c.to,
          setFragmentAsInserted(Fragment.from(c.node), createNewInsertAttrs(attrs), newTr.doc.type.schema)
        )
      }
    }
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

/** Will join other structural changes in the range of transaction steps to the new change moveNodeId,
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

  const relatedChanges = changeSet.changes.filter(
    (c) => c.dataTracked.moveNodeId && idsSet.has(c.dataTracked.moveNodeId)
  )
  // unified moveNodeId of the related transaction steps
  relatedChanges.map((c) =>
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

  return updateBlockNodesAttrs(sliceContent, (_, node) => {
    return { ..._, dataTracked: [addTrackIdIfDoesntExist(createNewStructureAttrs({ ...attrs, moveNodeId }))] }
  })
}

export const isStructuralChange = (tr: Transaction) =>
  tr.getMeta(TrackChangesAction.structuralChangeAction) &&
  tr.steps.length === 2 &&
  tr.steps[0] instanceof ReplaceStep &&
  tr.steps[1] instanceof ReplaceStep
