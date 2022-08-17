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
import { Transaction } from 'prosemirror-state'
import { Mapping } from 'prosemirror-transform'

import { ChangeSet } from '../ChangeSet'
import { IncompleteChange, TrackedAttrs, TrackedChange } from '../types/change'
import { getNodeTrackedData } from '../compute/nodeHelpers'

export function updateChangeAttrs(
  tr: Transaction,
  change: IncompleteChange,
  trackedAttrs: Partial<TrackedAttrs>,
  schema: Schema
): Transaction {
  const node = tr.doc.nodeAt(change.from)
  if (!node) {
    throw Error('No node at the from of change' + change)
  }
  const dataTracked = { ...getNodeTrackedData(node, schema), ...trackedAttrs }
  const oldMark = node.marks.find(
    (m) => m.type === schema.marks.tracked_insert || m.type === schema.marks.tracked_delete
  )
  if (change.type === 'text-change' && oldMark) {
    tr.addMark(change.from, change.to, oldMark.type.create({ ...oldMark.attrs, dataTracked }))
  } else if (change.type === 'node-change') {
    tr.setNodeMarkup(change.from, undefined, { ...node.attrs, dataTracked }, node.marks)
  }
  return tr
}

export function updateChangeChildrenAttributes(
  changes: TrackedChange[],
  tr: Transaction,
  mapping: Mapping
) {
  changes.forEach((c) => {
    if (c.type === 'node-change' && ChangeSet.shouldNotDelete(c)) {
      const from = mapping.map(c.from)
      const node = tr.doc.nodeAt(from)
      if (!node) {
        return
      }
      const attrs = { ...node.attrs, dataTracked: null }
      tr.setNodeMarkup(from, undefined, attrs, node.marks)
    }
  })
}
