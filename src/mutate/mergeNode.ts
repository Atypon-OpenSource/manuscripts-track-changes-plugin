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
import { Fragment, Node as PMNode } from 'prosemirror-model'
import { Transaction } from 'prosemirror-state'
import { canJoin } from 'prosemirror-transform'

/**
 * Deletes node but tries to leave its content intact by moving/wrapping it to a node before or after
 * @param node
 * @param pos
 * @param tr
 * @returns
 */
export function mergeNode(node: PMNode, pos: number, tr: Transaction) {
  if (canJoin(tr.doc, pos)) {
    return tr.join(pos)
  } else if (!tr.doc.resolve(pos).nodeBefore) {
    // for this case will just delete that node in `deleteNode.ts` as the join will not work
    return undefined
  }
  // TODO is this the same thing as join to above?
  const resPos = tr.doc.resolve(pos)
  const canMergeToNodeAbove = (resPos.parent !== tr.doc || resPos.nodeBefore) && node.firstChild?.isText
  if (canMergeToNodeAbove) {
    return tr.replaceWith(tr.mapping.map(pos), tr.mapping.map(pos + node.nodeSize), Fragment.empty)
  }
  return undefined
}
