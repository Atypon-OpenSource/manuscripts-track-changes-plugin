/*!
 * © 2025 Atypon Systems LLC
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
import { isMoved, isShadowDelete } from '../tracking/steps-trackers/qualifiers'
import { isDeleted, isDeletedText } from './shared-utils'

type callback = (node: PMNode, pos: number, parent: PMNode | null, index: number) => void | boolean

export enum Include {
  CLEAN,
  PENDING,
  ALL,
}

/**
 *
 * @param node - for which we want to read descendants but cleared from track changes information
 * @param include - level of inclusion or visibility that we want: CLEAN for only real confirmed content, PENDING to include tc changes if needed, and ALL to expose the DOM completely
 * @returns object with masked descendants with identical API as Node.descendants in prosemirror that can be used identically
 */
export function clear(node: PMNode, include = Include.CLEAN) {
  return {
    descendants: (fn: callback) => {
      node.descendants((node, pos, parent, index) => {
        // Include clean will expose only real inserted content
        if (
          include == Include.CLEAN &&
          (isShadowDelete(node) || isMoved(node) || isDeleted(node) || isDeletedText(node))
        ) {
          return false
        }
        // Include.PENDING will skip shadows but will expose otherwise pending content visible to user - either deleted or inserted
        if ((include == Include.PENDING && isShadowDelete(node)) || isMoved(node)) {
          return false
        }

        // by exclusion - if neither Include.PENDING nor Include.CLEAN haven't thwarted access to this node at this point - we can show it
        return fn(node, pos, parent, index)
      })
    },
  }
}
