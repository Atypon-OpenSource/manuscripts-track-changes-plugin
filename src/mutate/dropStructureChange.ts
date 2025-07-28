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
import { Transaction } from 'prosemirror-state'
import { Mapping, ReplaceStep } from 'prosemirror-transform'

import { TrackChangesAction } from '../actions'
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
 * This will join other structural changes to have new change moveNodeId, and remove the duplicated content of delete with moveNodeId
 */
export const joinStructuralChanges = (
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

  const mapping = new Mapping()
  newTr.doc.descendants((node, pos) => {
    const dataTracked = getBlockInlineTrackedData(node)?.find((c) => structureChangesId.has(c.moveNodeId))
    const duplicateDelete = getBlockInlineTrackedData(node)?.filter(
      (c) => c.operation === 'delete' && c.moveNodeId === moveNodeId
    )
    const structureChange = getBlockInlineTrackedData(node)?.filter(
      (c) => c.operation === 'structure' && structureChangesId.has(c.moveNodeId)
    )
    if (duplicateDelete?.length && structureChange?.length) {
      newTr.delete(mapping.map(pos), mapping.map(pos + node.nodeSize))
      mapping.appendMap(newTr.steps[newTr.steps.length - 1].getMap())
    } else if (dataTracked) {
      newTr.setNodeMarkup(mapping.map(pos), undefined, {
        ...node.attrs,
        dataTracked: getBlockInlineTrackedData(node)
          ?.map((c) =>
            structureChangesId.has(c.moveNodeId) && c.operation === 'delete' ? { ...c, moveNodeId } : c
          )
          .filter((c) => !structureChangesId.has(c.moveNodeId)),
      })
    }
  })
}
