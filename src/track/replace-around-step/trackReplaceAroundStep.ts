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
import { Node as PMNode, Schema, Slice } from 'prosemirror-model'
import type { EditorState, Transaction } from 'prosemirror-state'
import { ReplaceStep, ReplaceAroundStep } from 'prosemirror-transform'

import { deleteAndMergeSplitBlockNodes } from './deleteAndMergeSplitBlockNodes'
import { setFragmentAsInserted } from './setFragmentAsInserted'
import { log } from '../../utils/logger'
import { ExposedSlice } from '../../types/pm'
import { NewEmptyAttrs } from '../../types/track'
import { shouldMergeTrackedAttributes } from '../node-utils'
import * as trackUtils from './track-utils'

/**
 * Merges tracked marks between text nodes at a position
 *
 * Will work for any nodes that use tracked_insert or tracked_delete marks which may not be preferrable
 * if used for block nodes (since we possibly want to show the individual changed nodes).
 * Merging is done based on the userID, operation type and status.
 * @param pos
 * @param doc
 * @param newTr
 * @param schema
 */
function mergeTrackedMarks(pos: number, doc: PMNode, newTr: Transaction, schema: Schema) {
  const resolved = doc.resolve(pos)
  const { nodeAfter, nodeBefore } = resolved
  const leftMark = nodeBefore?.marks.filter(
    (m) => m.type === schema.marks.tracked_insert || m.type === schema.marks.tracked_delete
  )[0]
  const rightMark = nodeAfter?.marks.filter(
    (m) => m.type === schema.marks.tracked_insert || m.type === schema.marks.tracked_delete
  )[0]
  if (!nodeAfter || !nodeBefore || !leftMark || !rightMark || leftMark.type !== rightMark.type) {
    return
  }
  const leftAttrs = leftMark.attrs
  const rightAttrs = rightMark.attrs
  if (!shouldMergeTrackedAttributes(leftAttrs.dataTracked, rightAttrs.dataTracked)) {
    return
  }
  const newAttrs = {
    ...leftAttrs,
    createdAt: Math.max(leftAttrs.createdAt || 0, rightAttrs.createdAt || 0) || Date.now(),
  }
  const fromStartOfMark = pos - nodeBefore.nodeSize
  const toEndOfMark = pos + nodeAfter.nodeSize
  newTr.addMark(fromStartOfMark, toEndOfMark, leftMark.type.create(newAttrs))
}

export function trackReplaceAroundStep(
  step: ReplaceAroundStep,
  oldState: EditorState,
  newTr: Transaction,
  attrs: NewEmptyAttrs
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
  if (from === gapFrom && to === gapTo) {
    log.info('WRAPPED IN SOMETHING')
  } else if (!slice.size || slice.content.content.length === 2) {
    log.info('UNWRAPPED FROM SOMETHING')
  } else if (slice.size === 2 && gapFrom - from === 1 && to - gapTo === 1) {
    log.info('REPLACED WRAPPING')
  } else {
    log.info('????')
  }
  if (gapFrom - from > to - gapTo) {
    log.info('DELETED BEFORE GAP FROM')
  } else if (gapFrom - from < to - gapTo) {
    log.info('DELETED AFTER GAP TO')
  } else {
    log.info('EQUAL REPLACE BETWEEN GAPS')
  }

  // Invert the transaction step to prevent it from actually deleting or inserting anything
  const newStep = step.invert(oldState.doc)
  const stepResult = newTr.maybeStep(newStep)
  if (stepResult.failed) {
    log.error(`inverting ReplaceAroundStep failed: "${stepResult.failed}"`, newStep)
    return
  }
  const gap = oldState.doc.slice(gapFrom, gapTo)
  log.info('RETAINED GAP CONTENT', gap)
  step.getMap().forEach((fromA: number, toA: number, fromB: number, toB: number) => {
    log.info(`changed ranges: ${fromA} ${toA} ${fromB} ${toB}`)
  })
  // First apply the deleted range and update the insert slice to not include content that was deleted,
  // eg partial nodes in an open-ended slice
  const { deleteMap, newSliceContent } = deleteAndMergeSplitBlockNodes(
    from,
    to,
    { start: gapFrom, end: gapTo },
    newTr.doc,
    newTr,
    oldState.schema,
    attrs,
    slice
  )
  log.info('TR: new steps after applying delete', [...newTr.steps])
  // We only want to insert when there something inside the gap (actually would this be always true?)
  // or insert slice wasn't just start/end tokens (which we already merged inside deleteAndMergeSplitBlockNodes)
  if (gap.size > 0 || (!structure && newSliceContent.size > 0)) {
    log.info('newSliceContent', newSliceContent)
    // Since deleteAndMergeSplitBlockNodes modified the slice to not to contain any merged nodes,
    // the sides should be equal. TODO can they be other than 0?
    const openStart =
      slice.openStart !== slice.openEnd || newSliceContent.size === 0 ? 0 : slice.openStart
    const openEnd =
      slice.openStart !== slice.openEnd || newSliceContent.size === 0 ? 0 : slice.openEnd
    let insertedSlice = new Slice(
      setFragmentAsInserted(
        newSliceContent,
        trackUtils.createNewInsertAttrs(attrs),
        oldState.schema
      ),
      openStart,
      openEnd
    ) as ExposedSlice
    if (gap.size > 0) {
      insertedSlice = insertedSlice.insertAt(insert, gap.content)
      log.info('insertedSlice after inserted gap', insertedSlice)
    }
    const newStep = new ReplaceStep(
      deleteMap.map(gapFrom),
      deleteMap.map(gapTo),
      insertedSlice,
      false
    )
    const stepResult = newTr.maybeStep(newStep)
    if (stepResult.failed) {
      log.error(`insert ReplaceStep failed: "${stepResult.failed}"`, newStep)
      return
    }
    log.info('new steps after applying insert', [...newTr.steps])
    mergeTrackedMarks(deleteMap.map(gapFrom), newTr.doc, newTr, oldState.schema)
    mergeTrackedMarks(deleteMap.map(gapTo), newTr.doc, newTr, oldState.schema)
    // if (!wasNodeSelection) {
    //   newTr.setSelection(
    //     getSelectionStaticCreate(tr.selection, newTr.doc, toAWithOffset + insertedSlice.size)
    //   )
    // }
  } else {
    // Incase only deletion was applied, check whether tracked marks around deleted content can be merged
    mergeTrackedMarks(deleteMap.map(gapFrom), newTr.doc, newTr, oldState.schema)
    mergeTrackedMarks(deleteMap.map(gapTo), newTr.doc, newTr, oldState.schema)
    // if (!wasNodeSelection) {
    //   newTr.setSelection(getSelectionStaticCreate(tr.selection, newTr.doc, fromA))
    // }
  }
}