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
import { Fragment, Node as PMNode, Schema, Slice } from 'prosemirror-model'
import type { EditorState, Transaction } from 'prosemirror-state'
import { ReplaceStep, ReplaceAroundStep } from 'prosemirror-transform'

import { deleteAndMergeSplitNodes } from '../mutate/deleteAndMergeSplitNodes'
import { mergeTrackedMarks } from '../mutate/mergeTrackedMarks'
import { setFragmentAsInserted } from '../compute/setFragmentAsInserted'
import { log } from '../utils/logger'
import { ExposedReplaceStep, ExposedSlice } from '../types/pm'
import { NewEmptyAttrs } from '../types/track'
import * as trackUtils from '../utils/track-utils'
import { ChangeStep, InsertSliceStep } from '../types/step'

export function trackReplaceStep(
  step: ReplaceStep,
  oldState: EditorState,
  newTr: Transaction,
  attrs: NewEmptyAttrs
) {
  log.info('###### ReplaceStep ######')
  let selectionPos = 0,
    changeSteps: ChangeStep[] = []
  step.getMap().forEach((fromA: number, toA: number, fromB: number, toB: number) => {
    log.info(`changed ranges: ${fromA} ${toA} ${fromB} ${toB}`)
    const { slice } = step as ExposedReplaceStep
    // Invert the transaction step to prevent it from actually deleting or inserting anything
    const newStep = step.invert(oldState.doc)
    const stepResult = newTr.maybeStep(newStep)
    if (stepResult.failed) {
      log.error(`invert ReplaceStep failed: "${stepResult.failed}"`, newStep)
      return
    }
    log.info('TR: steps before applying delete', [...newTr.steps])
    // First apply the deleted range and update the insert slice to not include content that was deleted,
    // eg partial nodes in an open-ended slice
    const {
      sliceWasSplit,
      newSliceContent,
      steps: deleteSteps,
    } = deleteAndMergeSplitNodes(
      fromA,
      toA,
      undefined,
      oldState.doc,
      newTr,
      oldState.schema,
      attrs,
      slice
    )
    changeSteps.push(...deleteSteps)
    log.info('TR: steps after applying delete', [...newTr.steps])
    log.info('DELETE STEPS: ', changeSteps)
    const adjustedInsertPos = toA
    if (newSliceContent.size > 0) {
      log.info('newSliceContent', newSliceContent)
      // Since deleteAndMergeSplitBlockNodes modified the slice to not to contain any merged nodes,
      // the sides should be equal. TODO can they be other than 0?
      const openStart = slice.openStart !== slice.openEnd ? 0 : slice.openStart
      const openEnd = slice.openStart !== slice.openEnd ? 0 : slice.openEnd
      changeSteps.push({
        type: 'insert-slice',
        from: adjustedInsertPos,
        to: adjustedInsertPos,
        sliceWasSplit,
        slice: new Slice(
          setFragmentAsInserted(
            newSliceContent,
            trackUtils.createNewInsertAttrs(attrs),
            oldState.schema
          ),
          openStart,
          openEnd
        ) as ExposedSlice,
      })
    } else {
      // Incase only deletion was applied, check whether tracked marks around deleted content can be merged
      // mergeTrackedMarks(adjustedInsertPos, newTr.doc, newTr, oldState.schema)
      selectionPos = fromA
    }
  })
  return [changeSteps, selectionPos] as [ChangeStep[], number]
}
