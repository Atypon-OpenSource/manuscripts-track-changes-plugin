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
import { Node as PMNode, Slice } from 'prosemirror-model'
import type { EditorState, Transaction } from 'prosemirror-state'
import { ReplaceAroundStep } from 'prosemirror-transform'

import { TrackChangesAction } from '../../actions'
import { createNewInsertAttrs, NewEmptyAttrs } from '../../helpers/attributes'
import { setFragmentAsInserted, setFragmentAsWrapChange } from '../../helpers/fragment'
import { ExposedSlice } from '../../types/pm'
import { log } from '../../utils/logger'
import { deleteAndMergeSplitNodes } from '../lib/deleteAndMergeSplitNodes'
import { ChangeStep, TrTrackingContext } from '../types'
import { isLiftStep, isWrapStep } from './qualifiers'

function preserveDataTrackedFromPreviousStep(
  newTr: Transaction,
  step: ReplaceAroundStep,
  newStep: ReplaceAroundStep
) {
  // if revert step overrides dataTracked attrs in cases when it preserves the node but just reinserts it with
  // some changes (like in lifting when parent reinserted for every node that is lifted separately)
  const prevDoc = newTr.docs[newTr.docs.length - 2]
  if (prevDoc && (step.slice.openEnd || step.slice.openStart)) {
    // meaning there are nodes that we are gluing back together and we need to preserve the dataTracked that appeared
    // prevStepDoc has to be the doc created by the previously handled ReplaceAroundStep

    prevDoc.nodesBetween(newStep.from, newStep.to, (node, pos) => {
      // find if it's the same node that in the newStep.slice
      // if it is, repply dataTracked attributes on those nodes that were lost by the reversion
      newStep.slice.content.forEach((n, offset) => {
        if (n.type === node.type && !node.isText && n.attrs.id === node.attrs.id) {
          // this check is extremely insufficient and works only with very small size nodes
          // as nodes are moved around alot we can either do a deep comparison on attributes or rely on attrs.id
          // attrs.id however is an arbitrary attribute as far as prosemirror or track-changes plugin are concerned
          // the main guarantee here is actually just the fact that we iterate from the start of range and check only high level
          // nodes in the slice
          newTr.setNodeAttribute(newStep.from + offset, 'dataTracked', node.attrs.dataTracked)
        }
      })
    })
  }
  return newTr
}

export function trackReplaceAroundStep(
  step: ReplaceAroundStep,
  oldState: EditorState,
  tr: Transaction,
  newTr: Transaction,
  attrs: NewEmptyAttrs,
  currentStepDoc: PMNode,
  trContext: TrTrackingContext
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

  let stepResult = newTr.maybeStep(newStep)
  if (stepResult.failed) {
    // for some cases invert will fail due to sending multiple steps that update the same nodes
    log.error(`inverting ReplaceAroundStep failed: "${stepResult.failed}"`, newStep)
    return []
  }

  // If previous step made changes on the same content as current step, it could've overridden dataTracked attribute in the slice.
  preserveDataTrackedFromPreviousStep(newTr, step, newStep)

  const gap = currentStepDoc.slice(gapFrom, gapTo)
  log.info('RETAINED GAP CONTENT', gap)
  // First apply the deleted range and update the insert slice to not include content that was deleted,
  // eg partial nodes in an open-ended slice
  const {
    sliceWasSplit,
    newSliceContent,
    steps: deleteSteps,
    depth,
  } = deleteAndMergeSplitNodes(
    from,
    to,
    { start: gapFrom, end: gapTo, slice: gap, insert },
    newTr.doc,
    oldState.schema,
    attrs,
    slice
  )

  let fragment
  if (isWrapStep(step)) {
    fragment = setFragmentAsWrapChange(newSliceContent, attrs, oldState.schema)
  } else {
    fragment = setFragmentAsInserted(newSliceContent, createNewInsertAttrs(attrs), oldState.schema)
  }

  let steps: ChangeStep[] = deleteSteps
  // log.info('TR: new steps after applying delete', [...newTr.steps])
  log.info('DELETE STEPS: ', deleteSteps)
  // We only want to insert when there something inside the gap (actually would this be always true?)
  // or insert slice wasn't just start/end tokens (which we already merged inside deleteAndMergeSplitBlockNodes)
  // ^^answering above comment we could have meta node like(bibliography_item, contributor) will not have content at all,
  // and that case gap will be 0, for that will use updateMetaNode to indicate that we are going just to update that node

  let liftStep = isLiftStep(step)
  /**
   * Detecting if current set of steps performs a lift operation. Lift operation normally represented by at least 2 ReplaceAroundSteps.
   * Those steps occur on the same node and reverting deletes will make all the previous steps invalid.
   * To solve this issues, we buffer all the lifted fragments and insert them only on the last step of the sequence.
   */
  if (liftStep) {
    log.info('DETECTING INIT LIFT STEP: ', step)
    trContext.prevLiftStep = step
  } else if (trContext.prevLiftStep && trContext.prevLiftStep.gapFrom === step.gapTo) {
    log.info('DETECTING CHAIN LIFT STEP')
    trContext.prevLiftStep = step
  } else {
    trContext.prevLiftStep = undefined
  }

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
      let sliceContent = gap.content
      let insertPos = insert
      if (insert > insertedSlice.size && fragment.size > 0) {
        // when the inserted slice shrink we need to recalculate insert position based on the difference from original slice
        insertedSlice = new Slice(fragment, depth.start, depth.end) as ExposedSlice
        insertPos = insert - (slice.size - insertedSlice.size)
      }
      insertedSlice = insertedSlice.insertAt(fragment.size === 0 ? 0 : insertPos, sliceContent)
      log.info('insertedSlice after inserted gap', insertedSlice)
    }

    if (trContext.prevLiftStep) {
      // buffering new insertions for the lift step as described above
      trContext.liftFragment = trContext.liftFragment
        ? insertedSlice.content.append(trContext.liftFragment)
        : insertedSlice.content

      if (tr.steps.indexOf(step) === 0) {
        // last step detection, as we iterate backwards
        const fragmentTracked = setFragmentAsInserted(
          trContext.liftFragment,
          createNewInsertAttrs(attrs),
          oldState.schema
        )
        steps.push({
          type: 'insert-slice',
          from: from,
          to: from,
          slice: new Slice(fragmentTracked, 0, 0) as ExposedSlice,
          sliceWasSplit: true, // that's just... ehh... a flag to skip diffing that change
        })
      }
    } else {
      steps.push({
        type: 'insert-slice',
        from: sliceWasSplit ? gapTo : gapFrom,
        to: gapTo,
        slice: insertedSlice,
        sliceWasSplit,
      })
    }
  } else {
    // Incase only deletion was applied, check whether tracked marks around deleted content can be merged
    // mergeTrackedMarks(gapFrom, newTr.doc, newTr, oldState.schema)
    // mergeTrackedMarks(gapTo, newTr.doc, newTr, oldState.schema)
  }
  return steps
}
