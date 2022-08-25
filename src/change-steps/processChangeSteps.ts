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
import { Fragment, Schema } from 'prosemirror-model'
import type { Transaction } from 'prosemirror-state'
import { Mapping, ReplaceStep } from 'prosemirror-transform'

import { log } from '../utils/logger'
import { CHANGE_OPERATION, TrackedAttrs } from '../types/change'
import { ChangeStep } from '../types/step'
import { NewEmptyAttrs } from '../types/track'
import { deleteNode } from '../mutate/deleteNode'
import { deleteTextIfInserted } from '../mutate/deleteText'
import { mergeTrackedMarks } from '../mutate/mergeTrackedMarks'
import { addTrackIdIfDoesntExist, getMergeableMarkTrackedAttrs } from '../compute/nodeHelpers'
import * as trackUtils from '../utils/track-utils'

export function processChangeSteps(
  changes: ChangeStep[],
  startPos: number,
  newTr: Transaction,
  emptyAttrs: NewEmptyAttrs,
  schema: Schema
) {
  const mapping = new Mapping()
  const deleteAttrs = trackUtils.createNewDeleteAttrs(emptyAttrs)
  let selectionPos = startPos
  // @TODO add custom handler / condition?
  changes.forEach((c) => {
    let step = newTr.steps[newTr.steps.length - 1]
    log.info('process change: ', c)
    // const handled = customStepHandler(changes, newTr, emptyAttrs) // ChangeStep[] | undefined
    if (c.type === 'delete-node') {
      const dataTracked: TrackedAttrs | undefined = c.node.attrs.dataTracked
      const wasInsertedBySameUser =
        dataTracked?.operation === CHANGE_OPERATION.insert &&
        dataTracked.authorID === emptyAttrs.authorID
      if (wasInsertedBySameUser) {
        deleteNode(c.node, mapping.map(c.pos), newTr)
        const newestStep = newTr.steps[newTr.steps.length - 1]
        if (step !== newestStep) {
          mapping.appendMap(newestStep.getMap())
          step = newestStep
        }
        mergeTrackedMarks(mapping.map(c.pos), newTr.doc, newTr, schema)
      } else {
        const attrs = {
          ...c.node.attrs,
          dataTracked: addTrackIdIfDoesntExist(deleteAttrs),
        }
        newTr.setNodeMarkup(mapping.map(c.pos), undefined, attrs, c.node.marks)
      }
    } else if (c.type === 'delete-text') {
      const from = mapping.map(c.from, -1)
      const to = mapping.map(c.to, 1)
      const node = newTr.doc.nodeAt(mapping.map(c.pos))
      if (node?.marks.find((m) => m.type === schema.marks.tracked_insert)) {
        newTr.replaceWith(from, to, Fragment.empty)
        mergeTrackedMarks(from, newTr.doc, newTr, schema)
      } else {
        const leftNode = newTr.doc.resolve(from).nodeBefore
        const leftMarks = getMergeableMarkTrackedAttrs(leftNode, deleteAttrs, schema)
        const rightNode = newTr.doc.resolve(to).nodeAfter
        const rightMarks = getMergeableMarkTrackedAttrs(rightNode, deleteAttrs, schema)
        const fromStartOfMark = from - (leftNode && leftMarks ? leftNode.nodeSize : 0)
        const toEndOfMark = to + (rightNode && rightMarks ? rightNode.nodeSize : 0)
        const dataTracked = addTrackIdIfDoesntExist({
          ...leftMarks,
          ...rightMarks,
          ...deleteAttrs,
        })
        newTr.addMark(
          fromStartOfMark,
          toEndOfMark,
          schema.marks.tracked_delete.create({
            dataTracked,
          })
        )
      }
    } else if (c.type === 'merge-fragment') {
      let insertPos = mapping.map(c.mergePos)
      // The default insert position for block nodes is either the start of the merged content or the end.
      // Incase text was merged, this must be updated as the start or end of the node doesn't map to the
      // actual position of the merge. Currently the inserted content is inserted at the start or end
      // of the merged content, TODO reverse the start/end when end/start token?
      if (c.node.isText) {
        // When merging text we must delete text in the same go as well, as the from/to boundary goes through
        // the text node.
        insertPos = deleteTextIfInserted(
          c.node,
          mapping.map(c.pos),
          newTr,
          schema,
          deleteAttrs,
          mapping.map(c.from),
          mapping.map(c.to)
        )
        const newestStep = newTr.steps[newTr.steps.length - 1]
        if (step !== newestStep) {
          mapping.appendMap(newestStep.getMap())
          step = newestStep
        }
      }
      if (c.fragment.size > 0) {
        newTr.insert(insertPos, c.fragment)
      }
    } else if (c.type === 'insert-slice') {
      const newStep = new ReplaceStep(mapping.map(c.from), mapping.map(c.to), c.slice, false)
      const stepResult = newTr.maybeStep(newStep)
      if (stepResult.failed) {
        log.error(`insert ReplaceStep failed: "${stepResult.failed}"`, newStep)
        return
      }
      mergeTrackedMarks(mapping.map(c.from), newTr.doc, newTr, schema)
      mergeTrackedMarks(mapping.map(c.to), newTr.doc, newTr, schema)
      selectionPos = mapping.map(c.to) + c.slice.size
    } else if (c.type === 'update-node-attrs') {
      const oldDataTracked: Partial<TrackedAttrs> | undefined = c.oldAttrs.dataTracked
      const oldAttrs =
        oldDataTracked?.operation === CHANGE_OPERATION.set_node_attributes
          ? oldDataTracked.oldAttrs
          : c.oldAttrs
      const dataTracked = addTrackIdIfDoesntExist({
        ...oldDataTracked,
        oldAttrs,
        ...emptyAttrs,
        operation: CHANGE_OPERATION.set_node_attributes,
      })
      newTr.setNodeMarkup(mapping.map(c.pos), undefined, { ...c.newAttrs, dataTracked })
    }
    const newestStep = newTr.steps[newTr.steps.length - 1]
    if (step !== newestStep) {
      mapping.appendMap(newestStep.getMap())
    }
  })
  return [mapping, selectionPos] as [Mapping, number]
}
