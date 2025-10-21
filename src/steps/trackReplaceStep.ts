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
import { Fragment, Node as PMNode, Slice } from 'prosemirror-model'
import type { EditorState, Transaction } from 'prosemirror-state'
import { Mapping, ReplaceStep, StepResult } from 'prosemirror-transform'

import { getAction, TrackChangesAction } from '../actions'
import {
  setFragmentAsInserted,
  setFragmentAsMoveChange,
  setFragmentAsNodeSplit,
} from '../compute/setFragmentAsInserted'
import { deleteAndMergeSplitNodes } from '../mutate/deleteAndMergeSplitNodes'
import { joinStructureChanges } from '../mutate/structureChange'
import { ExposedReplaceStep, ExposedSlice } from '../types/pm'
import { ChangeStep } from '../types/step'
import { TrTrackingContext } from '../types/track'
import { log } from '../utils/logger'
import * as trackUtils from '../utils/track-utils'
import { mapChangeSteps } from '../utils/mapChangeStep'
import { NewEmptyAttrs } from '../attributes/types'
import { isStructuralChange } from '../changes/qualifiers'
import { isSplitStep } from './qualifiers'
import { createNewInsertAttrs, createNewMoveAttrs } from '../attributes'

export function trackReplaceStep(
  i: number,
  oldState: EditorState,
  newTr: Transaction,
  attrsTemplate: NewEmptyAttrs,
  tr: Transaction,
  deletedNodeMapping: Mapping,
  trContext: TrTrackingContext
) {
  const step = tr.steps[i] as ReplaceStep
  const moveID = trContext.stepsByGroupIDMap.get(step)

  const invertedStep = step.invert(tr.docs[i])

  const newStep = new ReplaceStep(
    deletedNodeMapping.map(invertedStep.from),
    deletedNodeMapping.map(invertedStep.to),
    invertedStep.slice
  )
  const stepResult = newTr.maybeStep(newStep)
  log.info('###### ReplaceStep ######')
  let selectionPos = 0
  const changeSteps: ChangeStep[] = []
  if (stepResult.failed) {
    log.error(`invert ReplaceStep failed: "${stepResult.failed}"`)
    return [changeSteps, undefined] as [ChangeStep[], number | undefined]
  }

  const attrs = { ...attrsTemplate }

  if (moveID) {
    attrs.moveNodeId = moveID
  }

  // Invert the transaction step to prevent it from actually deleting or inserting anything
  step.getMap().forEach((fromA: number, toA: number, fromB: number, toB: number) => {
    log.info(`changed ranges: ${fromA} ${toA} ${fromB} ${toB}`)
    const { slice } = step as ExposedReplaceStep
    log.info('TR: steps before applying delete', [...newTr.steps])
    // First apply the deleted range and update the insert slice to not include content that was deleted,
    // eg partial nodes in an open-ended slice

    const {
      sliceWasSplit,
      newSliceContent,
      steps: deleteSteps,
    } = deleteAndMergeSplitNodes(fromA, toA, undefined, tr.docs[i], oldState.schema, attrs, slice)
    changeSteps.push(...deleteSteps)
    log.info('TR: steps after applying delete', [...newTr.steps])
    log.info('DELETE STEPS: ', [...changeSteps])

    const backSpacedText = sameThingBackSpaced(changeSteps, newSliceContent)

    if (backSpacedText) {
      changeSteps.splice(changeSteps.indexOf(backSpacedText))
    }

    if (!backSpacedText && newSliceContent.size > 0) {
      log.info('newSliceContent', newSliceContent)

      let fragment = setFragmentAsInserted(newSliceContent, createNewInsertAttrs(attrs), oldState.schema)

      if (isStructuralChange(tr)) {
        fragment = joinStructureChanges(attrs, newSliceContent, fragment, tr, newTr)
      } else if (isSplitStep(step, oldState.selection, tr.getMeta('uiEvent'))) {
        fragment = setFragmentAsNodeSplit(newTr.doc.resolve(step.from), newTr, fragment, attrs)
      } else if (moveID) {
        // Extract indentation type from transaction
        const indentationType = getAction(tr, TrackChangesAction.indentationAction)?.action as
          | 'indent'
          | 'unindent'
          | undefined

        fragment = setFragmentAsMoveChange(newSliceContent, createNewMoveAttrs(attrs, indentationType))
      }
      // Since deleteAndMergeSplitBlockNodes modified the slice to not to contain any merged nodes,
      // the sides should be equal. TODO can they be other than 0?
      const openStart = slice.openStart !== slice.openEnd ? 0 : slice.openStart
      const openEnd = slice.openStart !== slice.openEnd ? 0 : slice.openEnd
      /*
        in reference to !(fromA === fromB) - if changed ranges didnt change with that step, we need to insert at the start of the new range to match 
        where the user added inserted content
      */
      const textWasDeleted = !!changeSteps.length && !(fromA === fromB)
      const isBlock = !!fragment.firstChild?.isBlock

      changeSteps.push({
        type: 'insert-slice',
        from: textWasDeleted ? fromB : isBlock ? toA : fromA, // if text was deleted and some new text is inserted then the position has to set in accordance the newly set text
        to: textWasDeleted ? fromB : isBlock ? toA : fromA, // block content needs to be inserted at the end so PM wont attempt to conver it to inline
        sliceWasSplit,
        slice: new Slice(fragment, openStart, openEnd) as ExposedSlice,
      })
    } else {
      // Incase only deletion was applied, check whether tracked marks around deleted content can be merged
      // mergeTrackedMarks(adjustedInsertPos, newTr.doc, newTr, oldState.schema)

      // When DEL is used, the selection is set to the end of the deleted content
      // TODO: 'window.event' is deprecated, find a better way to detect the key used for deletion
      // @ts-ignore
      const isDeleteEvent = window.event?.code === 'Delete'
      // @ts-ignore
      const isDeleteContentForward = window.event?.inputType === 'deleteContentForward'
      selectionPos = isDeleteEvent || isDeleteContentForward ? toA : fromA
    }
  })
  selectionPos = deletedNodeMapping.map(selectionPos)
  const doneSteps = mapChangeSteps(changeSteps, deletedNodeMapping)
  return [doneSteps, selectionPos] as [ChangeStep[], number]
}

function sameThingBackSpaced(changeSteps: ChangeStep[], newSliceContent: Fragment) {
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
      (step) => step.type === 'delete-text' && step.node.text === newSliceContent.content[0].text //  @TODO - get more precise proof of match. E.g.: position approximation
    )
    return correspondingDeletion
  }
  return undefined
}
