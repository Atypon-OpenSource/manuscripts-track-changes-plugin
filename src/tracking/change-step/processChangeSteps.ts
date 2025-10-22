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
import { Schema } from 'prosemirror-model'
import type { Transaction } from 'prosemirror-state'
import { Mapping, ReplaceStep } from 'prosemirror-transform'

import {
  addTrackIdIfDoesntExist,
  createNewDeleteAttrs,
  createNewUpdateAttrs,
  getBlockInlineTrackedData,
  NewEmptyAttrs,
} from '../../helpers/attributes'
import { CHANGE_OPERATION, CHANGE_STATUS, UpdateAttrs } from '../../types/change'
import { log } from '../../utils/logger'
import { deleteOrSetNodeDeleted } from '../lib/deleteNode'
import { deleteTextIfInserted } from '../lib/deleteTextIfInserted'
import { mergeTrackedMarks } from '../lib/mergeTrackedMarks'
import { ChangeStep, DeleteNodeStep } from './type'

/**
 * Applies worked out change steps to the new transaction and creating a document that has all the changes recorded
 *
 * @param changes
 * @param newTr
 * @param emptyAttrs
 * @param schema
 * @param deletedNodeMapping
 * @returns mapping, position of selection if changed
 */
export function processChangeSteps(
  changes: ChangeStep[],
  newTr: Transaction,
  emptyAttrs: NewEmptyAttrs,
  schema: Schema,
  deletedNodeMapping: Mapping
) {
  const mapping = new Mapping()
  const deleteAttrs = createNewDeleteAttrs(emptyAttrs)
  let selectionPos = undefined
  // @TODO add custom handler / condition?
  let deletesCounter = 0 // counter for deletion
  let isInserted = false // flag for inserted node
  let prevDelete: DeleteNodeStep

  changes.forEach((c) => {
    let step = newTr.steps[newTr.steps.length - 1]

    switch (c.type) {
      case 'delete-node': {
        deletesCounter++ // increase the counter for deleted nodes
        const prevDeletedNodeInserted = isInserted
        const trackedData = getBlockInlineTrackedData(c.node)
        const inserted = trackedData?.find((d) => d.operation === CHANGE_OPERATION.insert)
        // if that delete is a shadow for another structure change, we remove that node to avoid duplicating shadow
        const structure = trackedData?.find(
          (c) =>
            c.operation === CHANGE_OPERATION.structure &&
            deleteAttrs.moveNodeId &&
            c.moveNodeId !== deleteAttrs.moveNodeId
        )
        let childOfDeleted = false
        // if it's a deletion of a node inside a deleted node in this transaction, there is node need for separate step
        if (prevDelete) {
          prevDelete.node.descendants((node) => {
            if (childOfDeleted) {
              return false
            }
            if (node == c.node) {
              childOfDeleted = true
            }
          })
        }

        /* 1. For inserted node: the top node and its content (children nodes) is deleted in the first step
           2. Also if previous deleted node was "inserted" and the currently processed deleted node is
              a child of that node - don't produce a separate step to prevent collision and clutter
        */
        const isMoveOperation = !!emptyAttrs.moveNodeId
        if (
          (prevDelete &&
            c.pos < prevDelete.nodeEnd &&
            isInserted &&
            deletesCounter > 1 &&
            !isMoveOperation) ||
          (childOfDeleted && prevDeletedNodeInserted)
        ) {
          return false
        }

        deleteOrSetNodeDeleted(c.node, mapping.map(c.pos), newTr, deleteAttrs)
        prevDelete = c
        // for tables: not all children nodes have trackedData, so we need to check if the previous node was inserted
        // if yes, we can suppose that the current node was inserted too
        isInserted = !!inserted || !!structure || (!trackedData && isInserted)

        const newestStep = newTr.steps[newTr.steps.length - 1]
        if (isInserted || structure) {
          deletedNodeMapping.appendMap(newestStep.getMap())
        }
        if (step !== newestStep) {
          mapping.appendMap(newestStep.getMap())
          step = newestStep
        }

        mergeTrackedMarks(mapping.map(c.pos), newTr.doc, newTr, schema)
        break
      }
      case 'delete-text': {
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

        const textNewestStep = newTr.steps[newTr.steps.length - 1]

        if (node.marks.find((m) => m.type === schema.marks.tracked_insert)) {
          deletedNodeMapping.appendMap(textNewestStep.getMap())
        }

        if (step !== textNewestStep) {
          mapping.appendMap(textNewestStep.getMap())
          step = textNewestStep
        }
        mergeTrackedMarks(where, newTr.doc, newTr, schema)
        break
      }
      case 'merge-fragment': {
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

          if (c.node.marks.find((m) => m.type === schema.marks.tracked_insert)) {
            deletedNodeMapping.appendMap(newestStep.getMap())
          }

          if (step !== newestStep) {
            mapping.appendMap(newestStep.getMap())
            step = newestStep
          }
        }
        if (c.fragment.size > 0) {
          newTr.insert(insertPos, c.fragment)
        }
        break
      }
      case 'insert-slice': {
        const newStep = new ReplaceStep(mapping.map(c.from), mapping.map(c.to), c.slice, false)
        const stepResult = newTr.maybeStep(newStep)
        if (stepResult.failed) {
          log.error(`processChangeSteps: insert-slice ReplaceStep failed "${stepResult.failed}"`, newStep)
          return
        }
        mergeTrackedMarks(mapping.map(c.from), newTr.doc, newTr, schema)
        const to = mapping.map(c.to) + c.slice.size
        mergeTrackedMarks(
          mapping.map(c.to) + (to < newTr.doc.nodeSize ? c.slice.size : 0),
          newTr.doc,
          newTr,
          schema
        )
        selectionPos = mapping.map(c.to) + c.slice.size
        break
      }

      case 'update-node-attrs': {
        const oldDataTracked = getBlockInlineTrackedData(c.node) || []
        const oldUpdate = oldDataTracked.reverse().find((d) => {
          // reversing to start from the most recent change
          if (d.operation === CHANGE_OPERATION.set_node_attributes && d.status === CHANGE_STATUS.pending) {
            return true
          }
          return false
        }) as UpdateAttrs

        const { dataTracked, ...restAttrs } = c.node.attrs
        const oldAttrs = restAttrs
        const newDataTracked = [...oldDataTracked.filter((d) => !oldUpdate || d.id !== oldUpdate.id)]
        const newUpdate =
          oldUpdate && oldUpdate.status !== CHANGE_STATUS.rejected
            ? {
                ...oldUpdate,
                updatedAt: emptyAttrs.updatedAt,
              }
            : addTrackIdIfDoesntExist(createNewUpdateAttrs(emptyAttrs, c.node.attrs))
        // Dont add update changes if there exists already an insert change for this node
        if (
          (JSON.stringify(oldAttrs) !== JSON.stringify(c.newAttrs) ||
            c.node.type === c.node.type.schema.nodes.citation) &&
          !oldDataTracked.find(
            (d) =>
              (d.operation === CHANGE_OPERATION.insert || d.operation === CHANGE_OPERATION.wrap_with_node) &&
              d.status === CHANGE_STATUS.pending
          )
        ) {
          newDataTracked.push(newUpdate)
        }

        // Retain old dataTracked if there are no new changes
        const finalDataTracked = newDataTracked.length > 0 ? newDataTracked : oldDataTracked

        newTr.setNodeMarkup(
          mapping.map(c.pos),
          undefined,
          {
            ...c.newAttrs,
            dataTracked: finalDataTracked.length > 0 ? finalDataTracked : null,
          },
          c.node.marks
        )
        break
      }
      default:
        log.error(`processChangeSteps: unknown change type`, c)
        return
    }

    const newestStep = newTr.steps[newTr.steps.length - 1]
    if (step !== newestStep) {
      mapping.appendMap(newestStep.getMap())
    }
  })

  return [mapping, selectionPos] as [Mapping, number | undefined]
}
