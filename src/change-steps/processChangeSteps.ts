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
import { Schema } from 'prosemirror-model'
import type { Transaction } from 'prosemirror-state'
import { Mapping, ReplaceStep } from 'prosemirror-transform'

import { log } from '../utils/logger'
import { CHANGE_OPERATION, CHANGE_STATUS, UpdateAttrs } from '../types/change'
import { ChangeStep } from '../types/step'
import { NewEmptyAttrs } from '../types/track'
import { deleteOrSetNodeDeleted } from '../mutate/deleteNode'
import { deleteTextIfInserted } from '../mutate/deleteText'
import { mergeTrackedMarks } from '../mutate/mergeTrackedMarks'
import { addTrackIdIfDoesntExist, getBlockInlineTrackedData } from '../compute/nodeHelpers'
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
      deleteOrSetNodeDeleted(c.node, mapping.map(c.pos), newTr, deleteAttrs)
      const newestStep = newTr.steps[newTr.steps.length - 1]
      if (step !== newestStep) {
        mapping.appendMap(newestStep.getMap())
        step = newestStep
      }
      mergeTrackedMarks(mapping.map(c.pos), newTr.doc, newTr, schema)
    } else if (c.type === 'delete-text') {
      const node = newTr.doc.nodeAt(mapping.map(c.pos))
      if (!node) {
        log.error(`processChangeSteps: no text node found for text-change`, c)
        return
      }
      const where = deleteTextIfInserted(
        node,
        mapping.map(c.pos),
        newTr,
        schema,
        deleteAttrs,
        mapping.map(c.from),
        mapping.map(c.to)
      )
      mergeTrackedMarks(where, newTr.doc, newTr, schema)
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
        log.error(`processChangeSteps: insert-slice ReplaceStep failed "${stepResult.failed}"`, newStep)
        return
      }
      mergeTrackedMarks(mapping.map(c.from), newTr.doc, newTr, schema)
      const to = mapping.map(c.to) + c.slice.size
      mergeTrackedMarks(mapping.map(c.to) + (to < newTr.doc.nodeSize ? c.slice.size : 0), newTr.doc, newTr, schema)
      selectionPos = mapping.map(c.to) + c.slice.size
    } else if (c.type === 'update-node-attrs') {
      const oldDataTracked = getBlockInlineTrackedData(c.node) || []
      const oldUpdate = oldDataTracked.reverse().find((d) => {
        // reversing to start from the most recent change
        if (
          d.operation === CHANGE_OPERATION.set_node_attributes &&
          (d.status === CHANGE_STATUS.pending || d.status === CHANGE_STATUS.rejected)
        ) {
          return true
        }
        return false
      }) as UpdateAttrs

      // if the selected last change is with status "rejected" we need to use oldAttrs from it because
      // node's actual attributes represent the "rejected" values
      const lastChangeRejected = oldUpdate && oldUpdate.status === CHANGE_STATUS.rejected

      const sourceAttrs = oldUpdate?.oldAttrs || c.node.attrs
      const { dataTracked, ...restAttrs } = sourceAttrs
      const oldAttrs = lastChangeRejected ? oldUpdate.oldAttrs : restAttrs
      const newDataTracked = [
        ...oldDataTracked.filter((d) => !oldUpdate || d.id !== oldUpdate.id || lastChangeRejected),
      ]
      const newUpdate =
        oldUpdate && oldUpdate.status !== CHANGE_STATUS.rejected
          ? {
              ...oldUpdate,
              updatedAt: emptyAttrs.updatedAt,
            }
          : addTrackIdIfDoesntExist(
              trackUtils.createNewUpdateAttrs(emptyAttrs, lastChangeRejected ? oldAttrs : c.node.attrs)
            )
      // Dont add update changes if there exists already an insert change for this node
      if (
        (JSON.stringify(oldAttrs) !== JSON.stringify(c.newAttrs) ||
          c.node.type === c.node.type.schema.nodes.citation) &&
        !oldDataTracked.find(
          (d) => d.operation === CHANGE_OPERATION.insert && d.status === CHANGE_STATUS.pending
        )
      ) {
        newDataTracked.push(newUpdate)
      }
      newTr.setNodeMarkup(
        mapping.map(c.pos),
        undefined,
        {
          ...c.newAttrs,
          dataTracked: newDataTracked.length > 0 ? newDataTracked : null,
        },
        c.node.marks
      )
    }
    const newestStep = newTr.steps[newTr.steps.length - 1]
    if (step !== newestStep) {
      mapping.appendMap(newestStep.getMap())
    }
  })
  return [mapping, selectionPos] as [Mapping, number]
}
