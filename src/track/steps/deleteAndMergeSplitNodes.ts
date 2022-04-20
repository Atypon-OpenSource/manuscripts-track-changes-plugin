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
import { mergeTrackedMarks } from './mergeTrackedMarks'
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
    return start
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
    return toEndOfMark
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

/**
 * Applies deletion to the doc without actually deleting nodes that have not been inserted
 *
 * The hairiest part of this whole library which does a fair bit of magic to split the inserted slice
 * into pieces that can be inserted without deleting nodes in the doc. Basically we first split the
 * inserted slice into merged pieces _if_ the slice was open on either end. Then, we iterate over the deleted
 * range and see if the node in question was completely wrapped in the range (therefore fully deleted)
 * or only partially deleted by the slice. In that case, we merge the content from the inserted slice
 * and keep the original nodes if they do not contain insert attributes.
 *
 * It is definitely a messy function but so far this seems to have been the best approach to prevent
 * deletion of nodes with open slices. Other option would be to allow the deletions to take place but that
 * requires then inserting the deleted nodes back to the doc if their deletion should be prevented, which does
 * not seem trivial either.
 *
 * @param from start of the deleted range
 * @param to end of the deleted range
 * @param gap retained content in a ReplaceAroundStep, not deleted
 * @param startDoc doc before the deletion
 * @param newTr the new track transaction
 * @param schema ProseMirror schema
 * @param deleteAttrs attributes for the dataTracked object
 * @param insertSlice the inserted slice from ReplaceStep
 * @returns mapping adjusted by the applied operations & modified insert slice
 */
export function deleteAndMergeSplitNodes(
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
  let mergedInsertPos = undefined
  // No deletion applied, return default values
  if (from === to) {
    return {
      deleteMap,
      mergedInsertPos,
      newSliceContent: insertSlice.content,
    }
  }
  const { updatedSliceNodes, firstMergedNode, lastMergedNode } = splitSliceIntoMergedParts(
    insertSlice,
    gap !== undefined
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
    let step = newTr.steps[newTr.steps.length - 1]
    // nodeEnd > offsetFrom -> delete touches this node
    // eg (del 6 10) <p 5>|<t 6>cdf</t 9></p 10>| -> <p> nodeEnd 10 > from 6
    //
    // !nodeWasDeleted -> Check node wasn't already deleted by a previous deleteNode
    // This is quite tricky to wrap your head around and I've forgotten the nitty-gritty details already.
    // But from what I remember what it safeguards against is, when you've already deleted a node
    // say an inserted blockquote that had all its children deleted, nodesBetween still iterates over those
    // nodes and therefore we have to make this check to ensure they still exist in the doc.
    if (nodeEnd > offsetFrom && !nodeWasDeleted && !wasWithinGap) {
      // |<p>asdf</p>| -> node deleted completely
      const nodeCompletelyDeleted = offsetPos >= offsetFrom && nodeEnd <= offsetTo
      // The end token deleted eg:
      // <p 1>asdf|</p 7><p 7>bye</p 12>| + [<p>]hello</p> -> <p>asdfhello</p>
      // (del 6 12) + (ins [<p>]hello</p> openStart 1 openEnd 0)
      // (<p> nodeEnd 7) > (from 6) && (nodeEnd 7) <= (to 12)
      //
      // How about
      // <p 1>asdf|</p 7><p 7>|bye</p 12> + [<p>]hello</p><p>good[</p>] -> <p>asdfhello</p><p>goodbye</p>
      //
      // What about:
      // <p 1>asdf|</p 7><p 7 op="inserted">|bye</p 12> + empty -> <p>asdfbye</p>
      const endTokenDeleted = nodeEnd > offsetFrom && nodeEnd <= offsetTo

      // The start token deleted eg:
      // |<p 1>hey</p 6><p 6>|asdf</p 12> + <p>hello [</p>] -> <p>hello asdf</p>
      // (del 1 7) + (ins <p>hello [</p>] openStart 0 openEnd 1)
      // (<p> pos 6) >= (from 1) && (nodeEnd 12) - 1 > (to 7)
      const startTokenDeleted = offsetPos >= offsetFrom && nodeEnd - 1 > offsetTo
      if (!nodeCompletelyDeleted && (endTokenDeleted || startTokenDeleted)) {
        // Depth is often 1 when merging paragraphs or 2 for fully open blockquotes.
        // Incase of merging text within a ReplaceAroundStep the depth might be 1
        const depth = newTr.doc.resolve(offsetPos).depth
        const mergeContent = endTokenDeleted
          ? firstMergedNode?.mergedNodeContent
          : lastMergedNode?.mergedNodeContent
        // Insert inside a merged node only if the slice was open (openStart > 0) and there exists mergedNodeContent.
        // Then we only have to ensure the depth is at the right level, so say a fully open blockquote insert will
        // be merged at the lowest, paragraph level, instead of blockquote level.
        const mergeStartNode =
          endTokenDeleted &&
          insertSlice.openStart > 0 &&
          depth === insertStartDepth &&
          mergeContent !== undefined
        // Same as above, merge nodes manually if there exists an open slice with mergeable content.
        // Compared to deleting an end token however, the merged block node is set as deleted. This is due to
        // ProseMirror node semantics as start tokens are considered to contain the actual node itself.
        const mergeEndNode =
          startTokenDeleted &&
          insertSlice.openEnd > 0 &&
          depth === insertEndDepth &&
          mergeContent !== undefined
        if (mergeStartNode || mergeEndNode) {
          // The default insert position for block nodes is either the start of the merged content or the end.
          // Incase text was merged, this must be updated as the start or end of the node doesn't map to the
          // actual position of the merge. Currently the inserted content is inserted at the start or end
          // of the merged content, TODO reverse the start/end when end/start token?
          let insertPos = mergeStartNode
            ? nodeEnd - insertSlice.openStart
            : offsetPos + insertSlice.openEnd
          if (node.isText) {
            // When merging text we must delete text in the same go as well, as the from/to boundary goes through
            // the text node.
            insertPos = deleteTextIfInserted(
              node,
              pos,
              newTr,
              schema,
              deleteAttrs,
              offsetFrom,
              offsetTo
            )
            deleteMap.appendMap(newTr.steps[newTr.steps.length - 1].getMap())
            step = newTr.steps[newTr.steps.length - 1]
          }
          // Just as a fun fact that I found out while debugging this. Inserting text at paragraph position wraps
          // it into a new paragraph(!). So that's why you always offset your positions to insert it _inside_
          // the paragraph.
          if (mergeContent.size !== 0) {
            newTr.insert(
              insertPos,
              setFragmentAsInserted(
                mergeContent,
                {
                  ...deleteAttrs,
                  operation: CHANGE_OPERATION.insert,
                },
                schema
              )
            )
          }
          // Okay this is a bit ridiculous but it's used to adjust the insert pos when track changes prevents deletions
          // of merged nodes & content, as just using mapped toA in that case isn't the same.
          // The calculation is a bit mysterious, I admit.
          if (startTokenDeleted) {
            mergedInsertPos = offsetPos + insertSlice.openEnd - 1
          }
        } else if (node.isText) {
          // TODO this should be fixed in the case above
          deleteTextIfInserted(node, offsetPos, newTr, schema, deleteAttrs, offsetFrom, offsetTo)
        }
      } else if (node.isText) {
        // Text deletion is handled even when the deletion doesn't completely wrap the text node
        // (which is basically the case most of the time)
        deleteTextIfInserted(node, offsetPos, newTr, schema, deleteAttrs, offsetFrom, offsetTo)
      } else if (nodeCompletelyDeleted) {
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
    mergedInsertPos,
    newSliceContent: updatedSliceNodes
      ? Fragment.fromArray(updatedSliceNodes)
      : insertSlice.content,
  }
}
