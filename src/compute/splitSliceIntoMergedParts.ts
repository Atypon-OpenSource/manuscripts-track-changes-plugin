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

import { log } from '../utils/logger'
import { ExposedFragment, ExposedSlice } from '../types/pm'

/**
 * Recurses node children and returns the merged first/last node's content and the unmerged children
 *
 * For example when merging two blockquotes:
 * <bq><p>old|</p></bq>...| + [<bq><p>] inserted</p><p>2nd p</p></bq> -> <bq><p>old inserted</p><p>2nd p</p></bq>
 * The extracted merged and unmerged content from the insertSlice are:
 * {
 *   mergedNodeContent: <text> inserted</text>
 *   unmergedContent: [<p>2nd p</p>]
 * }
 * @param node
 * @param currentDepth
 * @param depth
 * @param first
 * @returns
 */
function getMergedNode(
  node: PMNode,
  currentDepth: number,
  depth: number,
  first: boolean
): {
  mergedNodeContent: ExposedFragment
  unmergedContent: ExposedFragment | undefined
} {
  if (currentDepth === depth) {
    return {
      mergedNodeContent: node.content as ExposedFragment,
      unmergedContent: undefined,
    }
  }
  const result: PMNode[] = []
  let merged = Fragment.empty as ExposedFragment
  node.content.forEach((n, _, i) => {
    if ((first && i === 0) || (!first && i === node.childCount - 1)) {
      const { mergedNodeContent, unmergedContent } = getMergedNode(
        n,
        currentDepth + 1,
        depth,
        first
      )
      merged = mergedNodeContent
      if (unmergedContent) {
        result.push(...unmergedContent.content)
      }
    } else {
      result.push(n)
    }
  })
  return {
    mergedNodeContent: merged,
    unmergedContent:
      result.length > 0 ? (Fragment.fromArray(result) as ExposedFragment) : undefined,
  }
}

/**
 * Filters merged nodes from an open insertSlice to manually merge them to prevent unwanted deletions
 *
 * So instead of joining the slice by its open sides, possibly deleting previous nodes, we can push the
 * changed content manually inside the merged nodes.
 * Eg. instead of doing `|<p>asdf</p><p>|bye</p>` automatically, we extract the merged nodes first:
 * {
 *  updatedSliceNodes: [<p>asdf</p>],
 *  firstMergedNode: <p>bye</p>,
 *  lastMergedNode: undefined,
 * }
 * @param insertSlice inserted slice
 */
export function splitSliceIntoMergedParts(insertSlice: ExposedSlice, mergeEqualSides = false) {
  const {
    openStart,
    openEnd,
    content: { firstChild, lastChild, content: nodes },
  } = insertSlice
  let updatedSliceNodes = nodes
  const mergeSides = openStart !== openEnd || mergeEqualSides
  const firstMergedNode =
    openStart > 0 && mergeSides && firstChild
      ? getMergedNode(firstChild, 1, openStart, true)
      : undefined
  const lastMergedNode =
    openEnd > 0 && mergeSides && lastChild ? getMergedNode(lastChild, 1, openEnd, false) : undefined
  if (firstMergedNode) {
    updatedSliceNodes = updatedSliceNodes.slice(1)
    if (firstMergedNode.unmergedContent) {
      updatedSliceNodes = [...firstMergedNode.unmergedContent.content, ...updatedSliceNodes]
    }
  }
  if (lastMergedNode) {
    updatedSliceNodes = updatedSliceNodes.slice(0, -1)
    if (lastMergedNode.unmergedContent) {
      updatedSliceNodes = [...updatedSliceNodes, ...lastMergedNode.unmergedContent.content]
    }
  }
  return {
    updatedSliceNodes,
    firstMergedNode,
    lastMergedNode,
  }
}
