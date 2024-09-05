/*!
 * © 2024 Atypon Systems LLC
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
import { ManuscriptNode } from '@manuscripts/transform'
import { Fragment, Schema, Slice } from 'prosemirror-model'
import { Transaction } from 'prosemirror-state'

import { ChangeSet } from '../ChangeSet'
import { CHANGE_OPERATION, CHANGE_STATUS, IncompleteChange, NodeSplitAttrs } from "../types/change";

function revertSplitNodeChange(
  tr: Transaction,
  change: IncompleteChange,
  status: CHANGE_STATUS,
  schema: Schema
) {
  let splitPos, splitNode

  tr.doc.content.descendants((node, pos, parent) => {
    if (node.isText) {
      const splitMark = node.marks.find(
        (m) =>
          m.type === schema.marks.tracked_insert &&
          m.attrs.dataTracked &&
          m.attrs.dataTracked.id === (change.dataTracked as NodeSplitAttrs).splitMarkerId
      )
      if (splitMark) {
        splitPos = pos
        splitNode = parent!
      }
      return false
    }
  })

  if (splitPos && splitNode) {
    const node = tr.doc.nodeAt(change.from) as ManuscriptNode
    if (status === CHANGE_STATUS.rejected) {
      tr.replaceWith(
        change.from,
        change.to,
        node.replace(0, node.content.size, Slice.maxOpen(Fragment.empty))
      )
      tr.replaceWith(splitPos, splitPos + 1, node.content)
    }
  }
}

function revertWrapNodeChange(tr: Transaction, change: IncompleteChange, status: CHANGE_STATUS) {
  if (status === CHANGE_STATUS.rejected) {
    let content = Fragment.from()
    const node = tr.doc.nodeAt(change.from)!
    node.content.forEach((node) => {
      content = content.append(node.content)
    })
    tr.replaceWith(change.from, change.to, node.type.create(node.attrs, null, node.marks))
    tr.insert(tr.mapping.map(change.to), content)
  }
}

export function revertRejectedChanges(
  tr: Transaction,
  schema: Schema,
  ids: string[],
  changeSet: ChangeSet,
  status: CHANGE_STATUS
) {
  if (status !== CHANGE_STATUS.rejected) {
    return
  }

  ids.forEach((id) => {
    const change = changeSet?.get(id)!
    if (change.dataTracked.operation === CHANGE_OPERATION.node_split) {
      revertSplitNodeChange(tr, change, status, schema)
    }
    if (change.dataTracked.operation === CHANGE_OPERATION.wrap_with_node) {
      revertWrapNodeChange(tr, change, status)
    }
  })
}
