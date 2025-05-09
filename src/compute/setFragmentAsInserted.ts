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
import { ManuscriptNode } from '@manuscripts/transform'
import { Fragment, Node as PMNode, ResolvedPos, Schema } from 'prosemirror-model'
import { Transaction } from 'prosemirror-state'

import { CHANGE_OPERATION, CHANGE_STATUS } from '../types/change'
import { NewEmptyAttrs, NewInsertAttrs, NewTrackedAttrs } from '../types/track'
import { log } from '../utils/logger'
import * as trackUtils from '../utils/track-utils'
import { uuidv4 } from '../utils/uuidv4'
import {
  addTrackIdIfDoesntExist,
  equalMarks,
  getBlockInlineTrackedData,
  getTextNodeTrackedMarkData,
} from './nodeHelpers'

function markInlineNodeChange(node: PMNode, newTrackAttrs: NewTrackedAttrs, schema: Schema) {
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

/**
 * Iterates over fragment's content and joins pasted text with old track marks
 *
 * This is not strictly necessary but it's kinda bad UX if the inserted text is split into parts
 * even when it's authored by the same user.
 * @param content
 * @param newTrackAttrs
 * @param schema
 * @returns
 */
function loopContentAndMergeText(content: Fragment, newTrackAttrs: NewTrackedAttrs, schema: Schema) {
  const updatedChildren: PMNode[] = []
  for (let i = 0; i < content.childCount; i += 1) {
    const recursed = recurseNodeContent(content.child(i), newTrackAttrs, schema)
    const prev = i > 0 ? updatedChildren[i - 1] : null
    if (
      prev?.isText &&
      recursed.isText &&
      equalMarks(prev, recursed) &&
      getTextNodeTrackedMarkData(prev, schema)?.operation === CHANGE_OPERATION.insert
    ) {
      updatedChildren.splice(i - 1, 1, schema.text('' + prev.text + recursed.text, prev.marks))
    } else {
      updatedChildren.push(recursed)
    }
  }
  return updatedChildren
}

function recurseNodeContent(node: PMNode, newTrackAttrs: NewTrackedAttrs, schema: Schema) {
  if (node.isText) {
    return markInlineNodeChange(node, newTrackAttrs, schema)
  } else if (node.isBlock || node.isInline) {
    const updatedChildren = loopContentAndMergeText(node.content, newTrackAttrs, schema)
    return node.type.create(
      {
        ...node.attrs,
        dataTracked: [addTrackIdIfDoesntExist(newTrackAttrs)],
      },
      Fragment.fromArray(updatedChildren),
      node.marks
    )
  } else {
    log.error(`unhandled node type: "${node.type.name}"`, node)
    return node
  }
}

export function setFragmentAsInserted(inserted: Fragment, insertAttrs: NewInsertAttrs, schema: Schema) {
  // Recurse the content in the inserted slice and either mark it tracked_insert or set node attrs
  const updatedInserted = loopContentAndMergeText(inserted, insertAttrs, schema)
  return updatedInserted.length === 0 ? Fragment.empty : Fragment.fromArray(updatedInserted)
}

export function setFragmentAsWrapChange(inserted: Fragment, attrs: NewEmptyAttrs, schema: Schema) {
  const content: PMNode[] = []

  inserted.forEach((node) => {
    content.push(
      node.type.create(
        {
          ...node.attrs,
          dataTracked: [addTrackIdIfDoesntExist(trackUtils.createNewWrapAttrs(attrs))],
        },
        setFragmentAsInserted(node.content, trackUtils.createNewInsertAttrs(attrs), schema),
        node.marks
      )
    )
  })

  return Fragment.from(content)
}

/**
 * Add split change to the source node parent, and to the last child which is the split content
 */
export function setFragmentAsNodeSplit(
  $pos: ResolvedPos,
  newTr: Transaction,
  inserted: Fragment,
  attrs: NewEmptyAttrs
) {
  const lastChild = inserted.lastChild!
  const referenceId = uuidv4()

  const parentPos = $pos.before($pos.depth)
  const parent = $pos.node($pos.depth)
  const oldDataTracked = getBlockInlineTrackedData(parent) || []
  newTr.setNodeMarkup(parentPos, undefined, {
    ...parent.attrs,
    dataTracked: [
      ...oldDataTracked.filter((c) => c.operation !== 'reference'),
      {
        ...addTrackIdIfDoesntExist(
          trackUtils.createNewReferenceAttrs({ ...attrs, status: CHANGE_STATUS.pending }, referenceId)
        ),
      },
    ],
  })

  // if the node has already split reference will move it to the new split
  const splitSource = oldDataTracked.find((c) => c.operation === 'reference')
  const dataTracked = { ...trackUtils.createNewSplitAttrs({ ...attrs }), id: referenceId }

  // will add split track attr to first child in list_item, as that will be more convenient to roll back text to the referenced node
  if (lastChild.type.name === 'list_item') {
    let firstChild = lastChild.content.firstChild as ManuscriptNode
    firstChild = firstChild.type.create(
      {
        ...lastChild.attrs,
        dataTracked: splitSource ? [dataTracked, splitSource] : [dataTracked],
      },
      firstChild.content
    )
    inserted = inserted.replaceChild(
      inserted.childCount - 1,
      lastChild.type.create(
        lastChild.attrs,
        lastChild.content.cut(firstChild.nodeSize).addToStart(firstChild)
      )
    )
  } else {
    inserted = inserted.replaceChild(
      inserted.childCount - 1,
      lastChild.type.create(
        {
          ...lastChild.attrs,
          dataTracked: splitSource ? [dataTracked, splitSource] : [dataTracked],
        },
        lastChild.content
      )
    )
  }
  return inserted
}
