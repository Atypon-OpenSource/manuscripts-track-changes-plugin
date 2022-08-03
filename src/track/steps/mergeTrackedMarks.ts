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
import { Node as PMNode, Schema } from 'prosemirror-model'
import type { Transaction } from 'prosemirror-state'

import { shouldMergeTrackedAttributes } from '../node-utils'
import type { TrackedAttrs } from 'types/change'

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
export function mergeTrackedMarks(pos: number, doc: PMNode, newTr: Transaction, schema: Schema) {
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
  const leftDataTracked: Partial<TrackedAttrs> = leftMark.attrs.dataTracked
  const rightDataTracked: Partial<TrackedAttrs> = rightMark.attrs.dataTracked
  if (!shouldMergeTrackedAttributes(leftDataTracked, rightDataTracked)) {
    return
  }
  const isLeftOlder =
    (leftDataTracked.createdAt || Number.MAX_VALUE) <
    (rightDataTracked.createdAt || Number.MAX_VALUE)
  const ancestorAttrs = isLeftOlder ? leftDataTracked : rightDataTracked
  const dataTracked = {
    ...ancestorAttrs,
    updatedAt: Date.now(),
  }
  const fromStartOfMark = pos - nodeBefore.nodeSize
  const toEndOfMark = pos + nodeAfter.nodeSize
  newTr.addMark(
    fromStartOfMark,
    toEndOfMark,
    leftMark.type.create({ ...leftMark.attrs, dataTracked })
  )
}
