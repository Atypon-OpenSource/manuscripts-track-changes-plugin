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

import { ExposedFragment } from '../../types/pm'
import { ChangeStep } from '../change-step/type'

/**
 * Matches deleted to inserted content and returns the first pos they differ and the updated
 * ChangeStep list.
 *
 * Based on https://github.com/ProseMirror/prosemirror-model/blob/master/src/diff.ts
 * @param matchedDeleted
 * @param deleted
 * @param inserted
 * @returns
 */
export function matchInserted(
  matchedDeleted: number,
  deleted: ChangeStep[],
  inserted: ExposedFragment
): [number, ChangeStep[]] {
  let matched: [number, ChangeStep[]] = [matchedDeleted, deleted]
  for (let i = 0; ; i += 1) {
    if (inserted.childCount === i) {
      return matched
    }
    const insNode = inserted.child(i)
    // @ts-ignore
    const adjDeleted: DeleteTextStep | DeleteNodeStep | undefined = matched[1].find(
      (d) =>
        (d.type === 'delete-text' && Math.max(d.pos, d.from) === matched[0]) ||
        (d.type === 'delete-node' && d.pos === matched[0])
    )
    if (insNode.type !== adjDeleted?.node?.type) {
      return matched
    } else if (insNode.isText && adjDeleted?.node) {
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
