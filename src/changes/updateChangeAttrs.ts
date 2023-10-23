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

import { log } from '../utils/logger'
import { ChangeSet } from '../ChangeSet'
import { IncompleteChange, TrackedAttrs, TrackedChange } from '../types/change'
import { getNodeTrackedData, getTextNodeTrackedMarkData, getBlockInlineTrackedData } from '../compute/nodeHelpers'

export function updateChangeAttrs(
  tr: Transaction,
  change: IncompleteChange,
  trackedAttrs: Partial<TrackedAttrs>,
  schema: Schema
): Transaction {
  const node = tr.doc.nodeAt(change.from)
  if (!node) {
    log.error('updateChangeAttrs: no node at the from of change ', change)
    return tr
  }
  const { operation } = trackedAttrs
  const oldTrackData =
    change.type === 'text-change' ? getTextNodeTrackedMarkData(node, schema) : getBlockInlineTrackedData(node)
  if (!operation) {
    log.warn('updateChangeAttrs: unable to determine operation of change ', change)
  } else if (!oldTrackData) {
    log.warn('updateChangeAttrs: no old dataTracked for change ', change)
  }
  if (change.type === 'text-change') {
    const oldMark = node.marks.find(
      (m) => m.type === schema.marks.tracked_insert || m.type === schema.marks.tracked_delete
    )
    if (!oldMark) {
      log.warn('updateChangeAttrs: no track marks for a text-change ', change)
      return tr
    }
    // TODO add operation based on mark type if it's undefined?
    tr.addMark(
      change.from,
      change.to,
      oldMark.type.create({ ...oldMark.attrs, dataTracked: { ...oldTrackData, ...trackedAttrs } })
    )
  } else if ((change.type === 'node-change' || change.type === 'node-attr-change') && !operation) {
    // Very weird edge-case if this happens
    tr.setNodeMarkup(change.from, undefined, { ...node.attrs, dataTracked: null }, node.marks)
  } else if (change.type === 'node-change' || change.type === 'node-attr-change') {
    const trackedDataSource = getBlockInlineTrackedData(node) || []
    const targetDataTracked = trackedDataSource.find((t) => change.id === t.id)
    const newDataTracked = trackedDataSource.map((oldTrack) => {
      if (targetDataTracked) {
        if (oldTrack.id === targetDataTracked.id) {
          return { ...oldTrack, ...trackedAttrs }
        }
        return oldTrack
      }

      if (oldTrack.operation === operation) {
        return { ...oldTrack, ...trackedAttrs }
      }
      return oldTrack
    })
    tr.setNodeMarkup(
      change.from,
      undefined,
      { ...node.attrs, dataTracked: newDataTracked.length === 0 ? null : newDataTracked },
      node.marks
    )
  }
  return tr
}

export function updateChangeChildrenAttributes(changes: TrackedChange[], tr: Transaction, mapping: Mapping) {
  changes.forEach((c) => {
    if (c.type === 'node-change' && !ChangeSet.shouldDeleteChange(c)) {
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
