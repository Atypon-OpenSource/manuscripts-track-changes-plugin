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
import { ReplaceAroundStep } from 'prosemirror-transform'

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
  // Invert the transaction step to prevent it from actually deleting or inserting anything
  const newStep = step.invert(oldState.doc)
  const stepResult = newTr.maybeStep(newStep)
  if (stepResult.failed) {
    log.error(`inverting ReplaceAroundStep failed: "${stepResult.failed}"`, newStep)
    return
  }
  step.getMap().forEach((fromA: number, toA: number, fromB: number, toB: number) => {
    log.info(`changed ranges: ${fromA} ${toA} ${fromB} ${toB}`)
  })
  // First apply the deleted range and update the insert slice to not include content that was deleted,
  // eg partial nodes in an open-ended slice
  const { deleteMap, mergedInsertPos, newSliceContent } = deleteAndMergeSplitBlockNodes(
    from,
    to,
    { start: gapFrom, end: gapTo },
    oldState.doc,
    newTr,
    oldState.schema,
    attrs,
    slice
  )
  log.info('TR: new steps after applying delete', [...newTr.steps])
  const toAWithOffset = mergedInsertPos ?? deleteMap.map(to)
  if (newSliceContent.size > 0) {
    log.info('newSliceContent', newSliceContent)
    // Since deleteAndMergeSplitBlockNodes modified the slice to not to contain any merged nodes,
    // the sides should be equal. TODO can they be other than 0?
    const openStart = slice.openStart !== slice.openEnd ? 0 : slice.openStart
    const openEnd = slice.openStart !== slice.openEnd ? 0 : slice.openEnd
    const insertAttrs = trackUtils.createNewInsertAttrs(attrs)
    const insertedSlice = new Slice(
      setFragmentAsInserted(newSliceContent, insertAttrs, oldState.schema),
      openStart,
      openEnd
    ) as ExposedSlice
    const newStep = new ReplaceAroundStep(
      from,
      to,
      gapFrom,
      gapTo,
      insertedSlice,
      insert,
      structure
    )
    const stepResult = newTr.maybeStep(newStep)
    if (stepResult.failed) {
      log.error(`insert ReplaceStep failed: "${stepResult.failed}"`, newStep)
      return
    }
    log.info('new steps after applying insert', [...newTr.steps])
    mergeTrackedMarks(toAWithOffset, newTr.doc, newTr, oldState.schema)
    mergeTrackedMarks(toAWithOffset + insertedSlice.size, newTr.doc, newTr, oldState.schema)
    // if (!wasNodeSelection) {
    //   newTr.setSelection(
    //     getSelectionStaticCreate(tr.selection, newTr.doc, toAWithOffset + insertedSlice.size)
    //   )
    // }
  } else {
    // Incase only deletion was applied, check whether tracked marks around deleted content can be merged
    mergeTrackedMarks(toAWithOffset, newTr.doc, newTr, oldState.schema)
    // if (!wasNodeSelection) {
    //   newTr.setSelection(getSelectionStaticCreate(tr.selection, newTr.doc, fromA))
    // }
  }
}
