/*!
 * © 2026 Atypon Systems LLC
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

import { Node as PMNode } from 'prosemirror-model'
import { Transaction } from 'prosemirror-state'

import { isMoved, isShadowDelete } from './steps-trackers/qualifiers'

export const SHADOW_ID_PREFIX = '__track__changes_shadow__'

/**
 * Adding prefixes for nodes in shadow/moved elements and removing prefixes when nodes are not in shadow anymore
 * and removing the prefix from nodes that are no longer in shadow context.
 *
 * This post-processing step ensures that shadow nodes (and their descendants)
 * don't create duplicate DOM IDs with their "real" counterparts.
 *
 * This is intentionally done after all the tracking work to avoid remapping and complicating all the tracking logic on the way.
 */
export function normalizeShadowIds(tr: Transaction): Transaction {
  const changes: Array<{ pos: number; node: PMNode; newId: string }> = []
  const shadowRanges: Array<{ from: number; to: number }> = []

  function isInShadowRange(pos: number): boolean {
    return shadowRanges.some((range) => pos >= range.from && pos < range.to)
  }

  tr.doc.descendants((node, pos) => {
    if (isShadowDelete(node) || isMoved(node)) {
      shadowRanges.push({ from: pos, to: pos + node.nodeSize })
    }

    if (typeof node.attrs.id === 'string' && node.attrs.id) {
      const currentId = node.attrs.id
      const hasShadowPrefix = currentId.startsWith(SHADOW_ID_PREFIX)
      const inShadow = isInShadowRange(pos)

      if (inShadow && !hasShadowPrefix) {
        changes.push({ pos, node, newId: SHADOW_ID_PREFIX + currentId })
      } else if (!inShadow && hasShadowPrefix) {
        changes.push({ pos, node, newId: currentId.slice(SHADOW_ID_PREFIX.length) })
      }
    }
    return true
  })

  // Apply changes in reverse document order to maintain valid positions without a need to use mapping
  for (let i = changes.length - 1; i >= 0; i--) {
    const { pos, node, newId } = changes[i]
    tr.setNodeMarkup(pos, null, { ...node.attrs, id: newId })
  }

  return tr
}
