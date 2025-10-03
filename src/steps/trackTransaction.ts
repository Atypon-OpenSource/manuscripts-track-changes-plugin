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
import { EditorState, Transaction } from 'prosemirror-state'
import { AddMarkStep, AttrStep, Mapping, ReplaceAroundStep, ReplaceStep, Step } from 'prosemirror-transform'

import { diffChangeSteps } from '../change-steps/diffChangeSteps'
import { processChangeSteps } from '../change-steps/processChangeSteps'
import { updateChangeAttrs } from '../changes/updateChangeAttrs'
import { getNodeTrackedData } from '../compute/nodeHelpers'
import { CHANGE_STATUS } from '../types/change'
import { ExposedReplaceStep } from '../types/pm'
import { NewEmptyAttrs, TrTrackingContext } from '../types/track'
import { log } from '../utils/logger'
import { mapChangeSteps } from '../utils/mapChangeStep'
import {
  isStructureSteps,
  excludeFromTracking,
  passThroughMeta,
  iterationIsValid,
} from '../utils/track-utils'
import { uuidv4 } from '../utils/uuidv4'
import trackAttrsChange from './trackAttrsChange'
import { trackReplaceAroundStep } from './trackReplaceAroundStep'
import { trackReplaceStep } from './trackReplaceStep'
import { fixAndSetSelectionAfterTracking } from './fixAndHandleSelection'

/**
 * Inverts transactions to wrap their contents/operations with track data instead
 *
 *
 * The main function of track changes that holds the most complex parts of this whole library.
 * Takes in as arguments the data from appendTransaction to reapply it with the track marks/attributes.
 * We could prevent the initial transaction from being applied all together but since invert works just
 * as well and we can use the intermediate doc for checking which nodes are changed, it's not prevented.
 *
 *
 *
 * @param tr Original transaction
 * @param oldState State before transaction
 * @param newTr Transaction created from the new editor state
 * @param authorID User id
 * @returns newTr that inverts the initial tr and applies track attributes/marks
 */

export function trackTransaction(
  tr: Transaction,
  oldState: EditorState,
  newTr: Transaction,
  authorID: string,
  clearedSteps: Step[],
  trContext: TrTrackingContext
) {
  const emptyAttrs: NewEmptyAttrs = {
    authorID,
    reviewedByID: null,
    createdAt: tr.time,
    updatedAt: tr.time,
    statusUpdateAt: 0, // has to be zero as first so changes are not differeniated at start
    status: CHANGE_STATUS.pending,
  }

  // Check for indentation metadata and treat it like a move operation

  // mapping for deleted content, that was inserted before
  const deletedNodeMapping = new Mapping()
  trContext = { ...trContext, deletedNodeMapping } as TrTrackingContext & { deletedNodeMapping: Mapping }
  let iterations = 0
  log.info('ORIGINAL transaction', tr)

  for (let i = clearedSteps.length - 1; i >= 0; i--) {
    const step = clearedSteps[i]
    if (!step) {
      continue
    }
    log.info('transaction step', step)
    iterations++
    if (!iterationIsValid(iterations, tr, newTr, step)) {
      continue
    } else if (step instanceof ReplaceStep) {
      const { slice } = step as ExposedReplaceStep
      if (slice?.content?.content?.length === 1 && excludeFromTracking(slice.content.content[0])) {
        // don't track nodes that don't have dataTracked attrs in schema, such as highlight marker nodes
        continue
      }
      let thisStepMapping = tr.mapping.slice(i + 1, i + 1)
      /*
      In reference to "const thisStepMapping = tr.mapping.slice(i + 1)""
      Remember that every step in a transaction is applied on top of the previous step in that transaction.
      So here, during tracking processing, each step is intended for its own document but not for the final document - the tr.doc
      Because of that when a step is processed it has to be remapped to all the steps that occured after it or it will be mismatched as if there were no steps after it.
      This is apparent only in transactions with multiple insertions/deletions across the document and, withtout such mapping, if the last
      step adds content before (in terms of position in the doc) the first step, the plugin will attempt to insert tracked replacement for the first change at a position
      that corresponds to the first change position if the second change (second in time but occuring earlier in doc) never occured.
      */
      const isDelete = step.from !== step.to && step.slice.content.size < step.to - step.from // i moved inverted step inside the step processor, @TODO - figure out the next steps

      if (isDelete || isStructureSteps(tr)) {
        thisStepMapping = deletedNodeMapping
      }

      let [steps, startPos] = trackReplaceStep(i, oldState, newTr, emptyAttrs, tr, thisStepMapping, trContext)

      if (steps.length === 1) {
        const step: any = steps[0] // eslint-disable-line @typescript-eslint/no-explicit-any
        if (excludeFromTracking(step?.node || step?.slice?.content?.content[0])) {
          // don't track deleted highlight marker nodes
          continue
        }
      }

      startPos = thisStepMapping.map(startPos)
      steps = mapChangeSteps(steps, thisStepMapping)

      log.info('CHANGES: ', steps)
      steps = diffChangeSteps(steps)
      log.info('DIFFED STEPS: ', steps)

      // if step is in movingPairs, add its uuid (Map entry key) as moveNodeId
      const [_, selectionPos] = processChangeSteps(
        steps,
        startPos || tr.selection.head, // In case startPos is it's default value 0, use the old selection head
        newTr,
        trContext.stepsByGroupIDMap.has(step)
          ? { ...emptyAttrs, moveNodeId: trContext.stepsByGroupIDMap.get(step) }
          : emptyAttrs,
        oldState.schema,
        deletedNodeMapping
      )

      trContext.selectionPosFromInsertion = selectionPos
    } else if (step instanceof ReplaceAroundStep) {
      let steps = trackReplaceAroundStep(step, oldState, tr, newTr, emptyAttrs, tr.docs[i], trContext)
      steps = diffChangeSteps(steps)
      log.info('DIFFED STEPS: ', steps)
      processChangeSteps(steps, tr.selection.from, newTr, emptyAttrs, oldState.schema, deletedNodeMapping)
    } else if (step instanceof AttrStep) {
      const changeSteps = trackAttrsChange(step, oldState, tr, newTr, emptyAttrs, tr.docs[i])
      processChangeSteps(
        changeSteps,
        tr.selection.from,
        newTr,
        emptyAttrs,
        oldState.schema,
        deletedNodeMapping
      )
    } else if (step instanceof AddMarkStep) {
      // adding a mark between text that has tracking_mark will split that text with tracking attributes that have the same id, so we update id to be unique
      const dataTracked = getNodeTrackedData(newTr.doc.nodeAt(step.from), oldState.schema)?.pop()
      if (dataTracked) {
        updateChangeAttrs(
          newTr,
          { id: dataTracked.id as string, from: step.from, to: step.to, type: 'text-change', dataTracked },
          { ...dataTracked, id: uuidv4() },
          oldState.schema
        )
      }
    }
    // TODO: here we could check whether adjacent inserts & deletes cancel each other out. - update: probably not a valid concern
    // However, this should not be done by diffing and only matching node or char by char instead since
    // it's A easier and B more intuitive to user.
  }
  newTr = passThroughMeta(tr, newTr)
  newTr = fixAndSetSelectionAfterTracking(newTr, tr, deletedNodeMapping, trContext)
  log.info('NEW transaction', newTr)
  return newTr
}
