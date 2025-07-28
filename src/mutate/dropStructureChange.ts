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
import { EditorState, Transaction } from 'prosemirror-state'
import { Mapping, ReplaceStep } from 'prosemirror-transform'

import { findChanges } from '../changes/findChanges'
import { updateChangeAttrs } from '../changes/updateChangeAttrs'
import { ChangeSet } from '../ChangeSet'
import { addTrackIdIfDoesntExist, getBlockInlineTrackedData } from '../compute/nodeHelpers'
import { CHANGE_OPERATION, NodeChange, TrackedChange } from '../types/change'
import { createNewInsertAttrs } from '../utils/track-utils'

export const dropStructureChange = (change: TrackedChange, changeSet: ChangeSet, tr: Transaction) => {
  // find delete with moveNodeId that is child in this change
  const movedChanges = changeSet.changes
    .filter((c) => c.dataTracked.operation === CHANGE_OPERATION.delete && c.dataTracked.moveNodeId)
    .filter((c) => c.from > change.from && c.to < change.to)
  const movedChangesSet = new Set(movedChanges.map((c) => c.dataTracked.moveNodeId))

  const structuralChanges = changeSet.changes.filter(
    (c) =>
      (c.dataTracked.operation === CHANGE_OPERATION.structure ||
        c.dataTracked.operation === CHANGE_OPERATION.move) &&
      movedChangesSet.has(c.dataTracked.moveNodeId)
  ) as NodeChange[]

  structuralChanges.map((c) => {
    const insertChange = addTrackIdIfDoesntExist(createNewInsertAttrs({ ...c.dataTracked }))

    tr.setNodeMarkup(tr.mapping.map(c.from), undefined, {
      ...c.node.attrs,
      dataTracked: [insertChange],
    })
  })
}

/**
 * look at the insert content if we have a structural changes and drop them by convert change with structure to insert
 * and remove moveNodeId from deleted nodes
 */
export const dropAdjacentStructuralChanges = (
  movingStepsAssociated: Map<ReplaceStep, string>,
  tr: Transaction,
  newTr: Transaction
) => {
  const moveNodeId = movingStepsAssociated.get(tr.steps[0] as ReplaceStep)
  const structureChangesId = new Set()
  const insertStep = tr.steps[0] as ReplaceStep
  insertStep.slice.content.descendants((node) => {
    const oldMoveId =
      !node.isText &&
      getBlockInlineTrackedData(node)?.find((c) => c.operation === CHANGE_OPERATION.structure)?.moveNodeId
    oldMoveId && oldMoveId !== moveNodeId && structureChangesId.add(oldMoveId)
  })

  if (!structureChangesId.size) {
    return
  }

  const changeSet = findChanges(EditorState.create({ doc: newTr.doc }))

  const droppedDeleteWithMoveIdChanges = changeSet.changes.filter(
    (c) =>
      c.dataTracked.operation === CHANGE_OPERATION.delete && structureChangesId.has(c.dataTracked.moveNodeId)
  )

  if (droppedDeleteWithMoveIdChanges.length) {
    droppedDeleteWithMoveIdChanges.map((c) =>
      updateChangeAttrs(newTr, c, { ...c.dataTracked, moveNodeId: undefined }, newTr.doc.type.schema)
    )
  }

  const duplicateChanges = changeSet.changes.filter(
    (c) =>
      c.dataTracked.operation === CHANGE_OPERATION.delete &&
      moveNodeId === c.dataTracked.moveNodeId &&
      c.type === 'node-change' &&
      structureChangesId.has(c.node.attrs.dataTracked[0]?.moveNodeId)
  )

  if (duplicateChanges.length) {
    const mapping = new Mapping()
    duplicateChanges.map((c) => {
      newTr.delete(mapping.map(c.from), mapping.map(c.to))
      mapping.appendMap(newTr.steps[newTr.steps.length - 1].getMap())
    })
  }
}
