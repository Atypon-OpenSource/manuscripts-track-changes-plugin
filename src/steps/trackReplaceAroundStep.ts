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
import { ReplaceAroundStep } from 'prosemirror-transform'

import { TrackChangesAction } from '../actions'
import { addTrackIdIfDoesntExist } from '../compute/nodeHelpers'
import { setFragmentAsInserted, setFragmentAsWrapChange } from '../compute/setFragmentAsInserted'
import { deleteAndMergeSplitNodes } from '../mutate/deleteAndMergeSplitNodes'
import { ExposedSlice } from '../types/pm'
import { ChangeStep } from '../types/step'
import { NewEmptyAttrs } from '../types/track'
import { log } from '../utils/logger'
import * as trackUtils from '../utils/track-utils'
import { isWrapStep } from '../utils/track-utils'

export function trackReplaceAroundStep(
  step: ReplaceAroundStep,
  oldState: EditorState,
  tr: Transaction,
  newTr: Transaction,
  attrs: NewEmptyAttrs,
  currentStepDoc: PMNode
) {
  log.info('###### ReplaceAroundStep ######')
  // @ts-ignore
  const {
    from,
    to,
    gapFrom,
    gapTo,
    insert,
    slice,
    structure,
  }: {
    from: number
    to: number
    gapFrom: number
    gapTo: number
    insert: number
    structure?: boolean
    slice: ExposedSlice
  } = step
  // Invert the transaction step to prevent it from actually deleting or inserting anything
  const newStep = step.invert(currentStepDoc)
  const stepResult = newTr.maybeStep(newStep)
  if (stepResult.failed) {
    // for some cases invert will fail due to sending multiple steps that update the same nodes
    log.error(`inverting ReplaceAroundStep failed: "${stepResult.failed}"`, newStep)
    return []
  }
  const gap = currentStepDoc.slice(gapFrom, gapTo)
  log.info('RETAINED GAP CONTENT', gap)
  // First apply the deleted range and update the insert slice to not include content that was deleted,
  // eg partial nodes in an open-ended slice
  const {
    sliceWasSplit,
    newSliceContent,
    steps: deleteSteps,
  } = deleteAndMergeSplitNodes(
    from,
    to,
    { start: gapFrom, end: gapTo },
    newTr.doc,
    newTr,
    oldState.schema,
    attrs,
    slice
  )

  let fragment
  if (isWrapStep(step)) {
    fragment = setFragmentAsWrapChange(newSliceContent, attrs, oldState.schema)
  } else {
    fragment = setFragmentAsInserted(newSliceContent, trackUtils.createNewInsertAttrs(attrs), oldState.schema)
  }

  const steps: ChangeStep[] = deleteSteps
  log.info('TR: new steps after applying delete', [...newTr.steps])
  log.info('DELETE STEPS: ', deleteSteps)
  // We only want to insert when there something inside the gap (actually would this be always true?)
  // or insert slice wasn't just start/end tokens (which we already merged inside deleteAndMergeSplitBlockNodes)
  // ^^answering above comment we could have meta node like(bibliography_item, contributor) will not have content at all,
  // and that case gap will be 0, for that will use updateMetaNode to indicate that we are going just to update that node
  if (
    gap.size > 0 ||
    (!structure && newSliceContent.size > 0) ||
    tr.getMeta(TrackChangesAction.updateMetaNode)
  ) {
    log.info('newSliceContent', newSliceContent)
    // Since deleteAndMergeSplitBlockNodes modified the slice to not to contain any merged nodes,
    // the sides should be equal. TODO can they be other than 0?
    const openStart = slice.openStart !== slice.openEnd || newSliceContent.size === 0 ? 0 : slice.openStart
    const openEnd = slice.openStart !== slice.openEnd || newSliceContent.size === 0 ? 0 : slice.openEnd
    let insertedSlice = new Slice(fragment, openStart, openEnd) as ExposedSlice
    if (gap.size > 0 || tr.getMeta(TrackChangesAction.updateMetaNode)) {
      log.info('insertedSlice before inserted gap', insertedSlice)
      insertedSlice = insertedSlice.insertAt(insertedSlice.size === 0 ? 0 : insert, gap.content)
      log.info('insertedSlice after inserted gap', insertedSlice)
    }
    deleteSteps.push({
      type: 'insert-slice',
      from: gapFrom,
      to: gapTo,
      slice: insertedSlice,
      sliceWasSplit,
    })
  } else {
    // Incase only deletion was applied, check whether tracked marks around deleted content can be merged
    // mergeTrackedMarks(gapFrom, newTr.doc, newTr, oldState.schema)
    // mergeTrackedMarks(gapTo, newTr.doc, newTr, oldState.schema)
  }
  return steps
}
