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
import { Fragment, Node as PMNode, Schema, Slice } from 'prosemirror-model'
import type { Transaction } from 'prosemirror-state'

import { log } from '../utils/logger'
import { ExposedFragment, ExposedSlice } from '../types/pm'
import { ChangeStep, DeleteNodeStep, DeleteTextStep, InsertSliceStep } from '../types/step'

function matchText(
  adjDeleted: DeleteTextStep,
  insNode: PMNode,
  offset: number,
  matchedDeleted: number,
  deleted: ChangeStep[]
): [number, ChangeStep[]] {
  const { pos, from, to, node: delNode } = adjDeleted
  let j = offset,
    d = from - pos,
    maxSteps = to - Math.max(pos, from)
  // Match text inside the inserted text node to the deleted text node
  for (
    ;
    maxSteps !== j && insNode.text![j] !== undefined && insNode.text![j] === delNode.text![d];
    j += 1, d += 1
  ) {
    matchedDeleted += 1
  }
  // this is needed incase diffing tr.doc
  // deleted.push({
  //   pos: pos,
  //   type: 'update-node-attrs',
  //   // Should check the attrs for equality in fixInconsistentChanges? to remove dataTracked completely
  //   oldAttrs: adjDeleted.node.attrs || {},
  //   newAttrs: child.attrs || {},
  // })
  deleted = deleted.filter((d) => d !== adjDeleted)
  if (maxSteps !== j) {
    deleted.push({
      pos,
      from: from + j - offset,
      to,
      type: 'delete-text',
      node: delNode,
    })
    return [matchedDeleted, deleted]
  }
  const nextTextDelete = deleted.find((d) => d.type === 'delete-text' && d.pos === to)
  if (nextTextDelete) {
    return matchText(nextTextDelete as DeleteTextStep, insNode, j, matchedDeleted, deleted)
  }
  return [matchedDeleted, deleted]
}

export function matchInserted(
  matchedDeleted: number,
  deleted: ChangeStep[],
  inserted: ExposedFragment
): [number, ChangeStep[]] {
  let matched: [number, ChangeStep[]] = [matchedDeleted, deleted]
  for (let i = 0; ; i += 1) {
    if (inserted.childCount === i) return matched
    const insNode = inserted.child(i)
    // @ts-ignore
    let adjDeleted: DeleteTextStep | DeleteNodeStep | undefined = matched[1].find(
      (d) =>
        (d.type === 'delete-text' && Math.max(d.pos, d.from) === matched[0]) ||
        (d.type === 'delete-node' && d.pos === matched[0])
    )
    if (insNode.type !== adjDeleted?.node?.type) {
      return matched
    } else if (insNode.isText && adjDeleted?.node) {
      matched = matchText(adjDeleted as DeleteTextStep, insNode, 0, matched[0], matched[1])
      continue
    } else if (insNode.content.size > 0 || adjDeleted?.node.content.size > 0) {
      // Move the inDeleted inside the block/inline node's boundary
      matched = matchInserted(
        matched[0] + 1,
        matched[1].filter((d) => d !== adjDeleted),
        insNode.content as ExposedFragment
      )
    } else {
      matched = [matched[0] + insNode.nodeSize, matched[1].filter((d) => d !== adjDeleted)]
    }
    // Omit dataTracked
    const { dataTracked, ...newAttrs } = insNode.attrs || {}
    matched[1].push({
      pos: adjDeleted.pos,
      type: 'update-node-attrs',
      node: adjDeleted.node,
      newAttrs,
    })
  }
}
