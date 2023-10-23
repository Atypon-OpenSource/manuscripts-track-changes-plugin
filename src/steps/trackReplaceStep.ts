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
import { ReplaceStep, ReplaceAroundStep, StepResult } from 'prosemirror-transform'

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
  attrs: NewEmptyAttrs,
  stepResult: StepResult,
  currentStepDoc: PMNode
) {
  log.info('###### ReplaceStep ######')
  let selectionPos = 0
  const changeSteps: ChangeStep[] = []

  // Invert the transaction step to prevent it from actually deleting or inserting anything
  step.getMap().forEach((fromA: number, toA: number, fromB: number, toB: number) => {
    log.info(`changed ranges: ${fromA} ${toA} ${fromB} ${toB}`)
    const { slice } = step as ExposedReplaceStep
    log.info('TR: steps before applying delete', [...newTr.steps])
    // First apply the deleted range and update the insert slice to not include content that was deleted,
    // eg partial nodes in an open-ended slice

    if (stepResult.failed) {
      log.error(`invert ReplaceStep failed: "${stepResult.failed}"`)
      return
    }

    const {
      sliceWasSplit,
      newSliceContent,
      steps: deleteSteps,
    } = deleteAndMergeSplitNodes(fromA, toA, undefined, currentStepDoc, newTr, oldState.schema, attrs, slice)
    changeSteps.push(...deleteSteps)
    log.info('TR: steps after applying delete', [...newTr.steps])
    log.info('DELETE STEPS: ', changeSteps)

    // console.log('CHANGE STEPS AT THIS POINT:')
    // console.log(JSON.parse(JSON.stringify(changeSteps)))

    function sameThingBackSpaced() {
      /*
      When deleting text with backspace and getting to the point of when a space and a character before a deleted piece of text is deleted
      the prosemirror would interpret it as moving the <del> node (this is a tracked deletion) one characted behind.       
      It normally results in [delete, delete, insert] set of ChangSteps where the 1st delete is for the delete done by
      the backspace key, the second delete and the insert are a misinterpretation of the moved text. So these last 2 steps have to be caught
      and removed as they are not meaningful.
      */

      if (changeSteps.length == 2 && newSliceContent.size > 0) {
        const correspondingDeletion = changeSteps.find(
          // @ts-ignore
          (step) => step.node.text === newSliceContent.content[0].text //  @TODO - get more precise proof of match. E.g.: position approximation
        )
        return correspondingDeletion
      }
      return undefined
    }

    const backSpacedText = sameThingBackSpaced()
    if (backSpacedText) {
      changeSteps.splice(changeSteps.indexOf(backSpacedText))
    }

    const textWasDeleted = !!changeSteps.length
    if (!backSpacedText && newSliceContent.size > 0) {
      log.info('newSliceContent', newSliceContent)

      // Since deleteAndMergeSplitBlockNodes modified the slice to not to contain any merged nodes,
      // the sides should be equal. TODO can they be other than 0?

      const openStart = slice.openStart !== slice.openEnd ? 0 : slice.openStart
      const openEnd = slice.openStart !== slice.openEnd ? 0 : slice.openEnd
      changeSteps.push({
        type: 'insert-slice',
        from: textWasDeleted ? fromB : toA, // if text was deleted and some new text is inserted then the position has to set in accordance the newly set text
        to: textWasDeleted ? toB - 1 : toA, // it's not entirely clear why using "fromB" is needed at all but in cases where there areno content deleted before - it will gointo infinite loop if toB -1 is used
        sliceWasSplit,
        slice: new Slice(
          setFragmentAsInserted(newSliceContent, trackUtils.createNewInsertAttrs(attrs), oldState.schema),
          openStart,
          openEnd
        ) as ExposedSlice,
      })
    } else {
      // Incase only deletion was applied, check whether tracked marks around deleted content can be merged
      // mergeTrackedMarks(adjustedInsertPos, newTr.doc, newTr, oldState.schema)

      // When DEL is used, the selection is set to the end of the deleted content
      // TODO: 'window.event' is deprecated, find a better way to detect the key used for deletion
      // @ts-ignore
      selectionPos = window.event?.code === 'Delete' || window.event?.inputType === 'deleteContentForward' ? toA : fromA
    }
  })
  return [changeSteps, selectionPos] as [ChangeStep[], number]
}
