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

import { log } from '../../utils/logger'
import { CHANGE_OPERATION } from '../../types/change'
import { NewInsertAttrs, NewTrackedAttrs } from '../../types/track'
import { addTrackIdIfDoesntExist } from '../node-utils'

function markInlineNodeChange(node: PMNode<any>, newTrackAttrs: NewTrackedAttrs, schema: Schema) {
  const filtered = node.marks.filter(
    (m) => m.type !== schema.marks.tracked_insert && m.type !== schema.marks.tracked_delete
  )
  const mark =
    newTrackAttrs.operation === CHANGE_OPERATION.insert
      ? schema.marks.tracked_insert
      : schema.marks.tracked_delete
  const createdMark = mark.create({
    dataTracked: addTrackIdIfDoesntExist(newTrackAttrs),
  })
  return node.mark(filtered.concat(createdMark))
}

function recurseNodeContent(node: PMNode<any>, newTrackAttrs: NewTrackedAttrs, schema: Schema) {
  if (node.isText) {
    return markInlineNodeChange(node, newTrackAttrs, schema)
  } else if (node.isBlock || node.isInline) {
    const updatedChildren: PMNode[] = []
    node.content.forEach((child) => {
      updatedChildren.push(recurseNodeContent(child, newTrackAttrs, schema))
    })
    return node.type.create(
      {
        ...node.attrs,
        dataTracked: addTrackIdIfDoesntExist(newTrackAttrs),
      },
      Fragment.fromArray(updatedChildren),
      node.marks
    )
  } else {
    log.error(`unhandled node type: "${node.type.name}"`, node)
    return node
  }
}

export function setFragmentAsInserted(
  inserted: Fragment,
  insertAttrs: NewInsertAttrs,
  schema: Schema
) {
  // Recurse the content in the inserted slice and either mark it tracked_insert or set node attrs
  const updatedInserted: PMNode[] = []
  inserted.forEach((n) => {
    updatedInserted.push(recurseNodeContent(n, insertAttrs, schema))
  })
  return updatedInserted.length === 0 ? inserted : Fragment.fromArray(updatedInserted)
}
