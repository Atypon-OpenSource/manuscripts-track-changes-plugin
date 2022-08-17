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
import { Fragment, Node as PMNode, Schema } from 'prosemirror-model'
import type { Transaction } from 'prosemirror-state'

import { log } from '../utils/logger'
import { NewDeleteAttrs } from '../types/track'
import { addTrackIdIfDoesntExist, getMergeableMarkTrackedAttrs } from '../compute/nodeHelpers'

/**
 * Deletes inserted text directly, otherwise wraps it with tracked_delete mark
 *
 * This would work for general inline nodes too, but since node marks don't work properly
 * with Yjs, attributes are used instead.
 * @param node
 * @param pos
 * @param newTr
 * @param schema
 * @param deleteAttrs
 * @param from
 * @param to
 */
export function deleteTextIfInserted(
  node: PMNode,
  pos: number,
  newTr: Transaction,
  schema: Schema,
  deleteAttrs: NewDeleteAttrs,
  from?: number,
  to?: number
) {
  const start = from ? Math.max(pos, from) : pos
  const nodeEnd = pos + node.nodeSize
  const end = to ? Math.min(nodeEnd, to) : nodeEnd
  if (node.marks.find((m) => m.type === schema.marks.tracked_insert)) {
    // Math.max(pos, from) is for picking always the start of the node,
    // not the start of the change (which might span multiple nodes).
    // Pos can be less than from as nodesBetween iterates through all nodes starting from the top block node
    newTr.replaceWith(start, end, Fragment.empty)
    return start
  } else {
    const leftNode = newTr.doc.resolve(start).nodeBefore
    const leftMarks = getMergeableMarkTrackedAttrs(leftNode, deleteAttrs, schema)
    const rightNode = newTr.doc.resolve(end).nodeAfter
    const rightMarks = getMergeableMarkTrackedAttrs(rightNode, deleteAttrs, schema)
    const fromStartOfMark = start - (leftNode && leftMarks ? leftNode.nodeSize : 0)
    const toEndOfMark = end + (rightNode && rightMarks ? rightNode.nodeSize : 0)
    const createdAt = Math.min(
      leftMarks?.createdAt || Number.MAX_VALUE,
      rightMarks?.createdAt || Number.MAX_VALUE,
      deleteAttrs.createdAt
    )
    const dataTracked = addTrackIdIfDoesntExist({
      ...leftMarks,
      ...rightMarks,
      ...deleteAttrs,
      createdAt,
    })
    newTr.addMark(
      fromStartOfMark,
      toEndOfMark,
      schema.marks.tracked_delete.create({
        dataTracked,
      })
    )
    return toEndOfMark
  }
}
