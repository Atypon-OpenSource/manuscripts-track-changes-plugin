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
import type { Transaction } from 'prosemirror-state'
import { Mapping } from 'prosemirror-transform'

import { log } from '../../utils/logger'
import { CHANGE_OPERATION, TrackedAttrs } from '../../types/change'
import { ExposedFragment, ExposedSlice } from '../../types/pm'
import { NewDeleteAttrs, NewEmptyAttrs } from '../../types/track'
import { addTrackIdIfDoesntExist, getMergeableMarkTrackedAttrs } from '../node-utils'
import { setFragmentAsInserted } from './setFragmentAsInserted'
import * as trackUtils from './track-utils'

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
  const unmergedContent =
    result.length > 0 ? (Fragment.fromArray(result) as ExposedFragment) : undefined
  return {
    mergedNodeContent: merged,
    unmergedContent,
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
function splitSliceIntoMergedParts(insertSlice: ExposedSlice, mergeEqualSides = false) {
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

/**
 * Deletes inserted text directly, otherwise wraps it with tracked_delete mark
 *
 * This would work for general inline nodes too, but since node marks don't work properly
 * with Yjs, attributes are used instead.
 * @param node
 * @param pos
 * @param newTr
 * @param schema
 * @param deleteAttrs
 * @param from
 * @param to
 */
function deleteTextIfInserted(
  node: PMNode,
  pos: number,
  newTr: Transaction,
  schema: Schema,
  deleteAttrs: NewDeleteAttrs,
  from?: number,
  to?: number
) {
  const start = from ? Math.max(pos, from) : pos
  const nodeEnd = pos + node.nodeSize
  const end = to ? Math.min(nodeEnd, to) : nodeEnd
  if (node.marks.find((m) => m.type === schema.marks.tracked_insert)) {
    // Math.max(pos, from) is for picking always the start of the node,
    // not the start of the change (which might span multiple nodes).
    // Pos can be less than from as nodesBetween iterates through all nodes starting from the top block node
    newTr.replaceWith(start, end, Fragment.empty)
  } else {
    const leftNode = newTr.doc.resolve(start).nodeBefore
    const leftMarks = getMergeableMarkTrackedAttrs(leftNode, deleteAttrs, schema)
    const rightNode = newTr.doc.resolve(end).nodeAfter
    const rightMarks = getMergeableMarkTrackedAttrs(rightNode, deleteAttrs, schema)
    const fromStartOfMark = start - (leftNode && leftMarks ? leftNode.nodeSize : 0)
    const toEndOfMark = end + (rightNode && rightMarks ? rightNode.nodeSize : 0)
    const dataTracked = addTrackIdIfDoesntExist({
      ...leftMarks,
      ...rightMarks,
      ...deleteAttrs,
    })
    newTr.addMark(
      fromStartOfMark,
      toEndOfMark,
      schema.marks.tracked_delete.create({
        dataTracked,
      })
    )
  }
}

/**
 * Deletes inserted block or inline node, otherwise adds `dataTracked` object with CHANGE_STATUS 'deleted'
 * @param node
 * @param pos
 * @param newTr
 * @param deleteAttrs
 */
function deleteNode(node: PMNode, pos: number, newTr: Transaction, deleteAttrs: NewDeleteAttrs) {
  const dataTracked: TrackedAttrs | undefined = node.attrs.dataTracked
  const wasInsertedBySameUser =
    dataTracked?.operation === CHANGE_OPERATION.insert && dataTracked.userID === deleteAttrs.userID
  if (wasInsertedBySameUser) {
    const resPos = newTr.doc.resolve(pos)
    const canMergeToNodeAbove =
      (resPos.parent !== newTr.doc || resPos.nodeBefore) && node.firstChild?.isText
    // TODO ensure this works and blocks at the start of doc cant be deleted (as they wont merge to node above)
    if (canMergeToNodeAbove) {
      newTr.replaceWith(pos - 1, pos + 1, Fragment.empty)
    } else {
      newTr.delete(pos, pos + node.nodeSize)
    }
  } else {
    const attrs = {
      ...node.attrs,
      dataTracked: addTrackIdIfDoesntExist(deleteAttrs),
    }
    newTr.setNodeMarkup(pos, undefined, attrs, node.marks)
  }
}

export function deleteAndMergeSplitBlockNodes(
  from: number,
  to: number,
  gap: { start: number; end: number } | undefined,
  startDoc: PMNode,
  newTr: Transaction,
  schema: Schema,
  trackAttrs: NewEmptyAttrs,
  insertSlice: ExposedSlice
) {
  const deleteMap = new Mapping()
  // No deletion applied, return default values
  if (from === to) {
    return {
      deleteMap,
      newSliceContent: insertSlice.content,
    }
  }
  const { updatedSliceNodes, firstMergedNode, lastMergedNode } = splitSliceIntoMergedParts(
    insertSlice,
    true
  )
  const insertStartDepth = insertSlice.openStart !== insertSlice.openEnd ? 0 : insertSlice.openStart
  const insertEndDepth = insertSlice.openStart !== insertSlice.openEnd ? 0 : insertSlice.openEnd
  const deleteAttrs = trackUtils.createNewDeleteAttrs(trackAttrs)
  startDoc.nodesBetween(from, to, (node, pos) => {
    const { pos: offsetPos, deleted: nodeWasDeleted } = deleteMap.mapResult(pos, 1)
    const offsetFrom = deleteMap.map(from, -1)
    const offsetTo = deleteMap.map(to, 1)
    const wasWithinGap = gap && offsetPos >= deleteMap.map(gap.start, -1)
    const nodeEnd = offsetPos + node.nodeSize
    const step = newTr.steps[newTr.steps.length - 1]
    if (nodeEnd > offsetFrom && !nodeWasDeleted && !wasWithinGap) {
      if (node.isText) {
        deleteTextIfInserted(node, offsetPos, newTr, schema, deleteAttrs, offsetFrom, offsetTo)
      } else if (node.isBlock) {
        if (offsetPos >= offsetFrom && nodeEnd <= offsetTo) {
          deleteNode(node, offsetPos, newTr, deleteAttrs)
        } else if (nodeEnd > offsetFrom && nodeEnd <= offsetTo) {
          const depth = newTr.doc.resolve(offsetPos).depth
          if (
            insertSlice.openStart > 0 &&
            depth === insertStartDepth &&
            firstMergedNode?.mergedNodeContent
          ) {
            newTr.insert(
              nodeEnd - insertSlice.openStart,
              setFragmentAsInserted(
                firstMergedNode.mergedNodeContent,
                {
                  ...deleteAttrs,
                  operation: CHANGE_OPERATION.insert,
                },
                schema
              )
            )
          }
        } else if (offsetPos >= offsetFrom && nodeEnd - 1 > offsetTo) {
          const depth = newTr.doc.resolve(offsetPos).depth
          if (
            insertSlice.openEnd > 0 &&
            depth === insertEndDepth &&
            lastMergedNode?.mergedNodeContent
          ) {
            newTr.insert(
              offsetPos + insertSlice.openEnd,
              setFragmentAsInserted(
                lastMergedNode.mergedNodeContent,
                {
                  ...deleteAttrs,
                  operation: CHANGE_OPERATION.insert,
                },
                schema
              )
            )
          } else if (insertSlice.openStart === insertSlice.openEnd) {
            deleteNode(node, offsetPos, newTr, deleteAttrs)
          }
        }
      } else if (!nodeWasDeleted && !wasWithinGap) {
        deleteNode(node, offsetPos, newTr, deleteAttrs)
      }
    }
    const newestStep = newTr.steps[newTr.steps.length - 1]
    if (step !== newestStep) {
      deleteMap.appendMap(newestStep.getMap())
    }
  })
  return {
    deleteMap,
    newSliceContent: updatedSliceNodes
      ? Fragment.fromArray(updatedSliceNodes)
      : insertSlice.content,
  }
}
