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

import { log } from '../utils/logger'
import { ExposedSlice } from '../types/pm'
import { NewEmptyAttrs } from '../types/track'
import { deleteOrSetNodeDeleted } from './deleteNode'
import { deleteTextIfInserted } from './deleteText'
import { splitSliceIntoMergedParts } from '../compute/splitSliceIntoMergedParts'
import { setFragmentAsInserted } from '../compute/setFragmentAsInserted'
import * as trackUtils from '../utils/track-utils'

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
  const mergedInsertPos = undefined
  // No deletion applied, return default values
  if (from === to) {
    return {
      deleteMap,
      mergedInsertPos,
      newSliceContent: insertSlice.content,
    }
  }
  const { openStart, openEnd } = insertSlice
  const { updatedSliceNodes, firstMergedNode, lastMergedNode } = splitSliceIntoMergedParts(
    insertSlice,
    gap !== undefined
  )
  const deleteAttrs = trackUtils.createNewDeleteAttrs(trackAttrs)
  let mergingStartSide = true
  startDoc.nodesBetween(from, to, (node, pos) => {
    const { pos: offsetPos, deleted: nodeWasDeleted } = deleteMap.mapResult(pos, 1)
    const offsetFrom = deleteMap.map(from, -1)
    const offsetTo = deleteMap.map(to, 1)
    const nodeEnd = offsetPos + node.nodeSize
    // So this insane boolean checks for ReplaceAroundStep gaps and whether the node should be skipped
    // since the content inside gap should stay unchanged.
    // All other nodes except text nodes consist of one start and end token (or just a single token for atoms).
    // For them we can just check whether the start token is within the gap eg pos is 10 when gap (8, 18) to
    // determine whether it should be skipped.
    // For text nodes though, since they are continous, they might only partially be enclosed in the gap
    // eg. pos 10 when gap is (8, 18) BUT if their nodeEnd goes past the gap's end eg nodeEnd 20 they actually
    // are altered and should not be skipped.
    // @TODO ATM 20.7.2022 there doesn't seem to be tests that capture this.
    const wasWithinGap =
      gap &&
      ((!node.isText && offsetPos >= deleteMap.map(gap.start, -1)) ||
        (node.isText &&
          offsetPos <= deleteMap.map(gap.start, -1) &&
          nodeEnd >= deleteMap.map(gap.end, -1)))
    let step = newTr.steps[newTr.steps.length - 1]
    // nodeEnd > offsetFrom -> delete touches this node
    // eg (del 6 10) <p 5>|<t 6>cdf</t 9></p 10>| -> <p> nodeEnd 10 > from 6
    //
    // !nodeWasDeleted -> Check node wasn't already deleted by a previous deleteNode
    // This is quite tricky to wrap your head around and I've forgotten the nitty-gritty details already.
    // But from what I remember what it safeguards against is, when you've already deleted a node
    // say an inserted blockquote that had all its children deleted, nodesBetween still iterates over those
    // nodes and therefore we have to make this check to ensure they still exist in the doc.
    //
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
      const endTokenDeleted = nodeEnd <= offsetTo

      // The start token deleted eg:
      // |<p1 0>hey</p 6><p2 6>|asdf</p 12> + <p3>hello [</p>] -> <p3>hello asdf</p2>
      // (del 0 7) + (ins <p>hello [</p>] openStart 0 openEnd 1)
      // (<p1> pos 0) >= (from 0) && (nodeEnd 6) - 1 > (to 7) == false???
      // (<p2> pos 6) >= (from 0) && (nodeEnd 12) - 1 > (to 7) == true
      //
      const startTokenDeleted = offsetPos >= offsetFrom // && nodeEnd - 1 > offsetTo
      if (
        node.isText ||
        (!endTokenDeleted && startTokenDeleted) ||
        (endTokenDeleted && !startTokenDeleted)
      ) {
        // Since we don't know which side to merge with wholly deleted TextNodes, we use this boolean to remember
        // whether we have entered the endSide of the mergeable blockNodes. Also applies for partial TextNodes
        // (which we could determine without this).
        if (!endTokenDeleted && startTokenDeleted) {
          mergingStartSide = false
        }
        // Depth is often 1 when merging paragraphs or 2 for fully open blockquotes.
        // Incase of merging text within a ReplaceAroundStep the depth might be 1
        const depth = newTr.doc.resolve(offsetPos).depth
        const mergeContent = mergingStartSide
          ? firstMergedNode?.mergedNodeContent
          : lastMergedNode?.mergedNodeContent
        // Insert inside a merged node only if the slice was open (openStart > 0) and there exists mergedNodeContent.
        // Then we only have to ensure the depth is at the right level, so say a fully open blockquote insert will
        // be merged at the lowest, paragraph level, instead of blockquote level.
        const mergeStartNode =
          endTokenDeleted && openStart > 0 && depth === openStart && mergeContent !== undefined
        // Same as above, merge nodes manually if there exists an open slice with mergeable content.
        // Compared to deleting an end token however, the merged block node is set as deleted. This is due to
        // ProseMirror node semantics as start tokens are considered to contain the actual node itself.
        const mergeEndNode =
          startTokenDeleted && openEnd > 0 && depth === openEnd && mergeContent !== undefined
        if (mergeStartNode || mergeEndNode) {
          // The default insert position for block nodes is either the start of the merged content or the end.
          // Incase text was merged, this must be updated as the start or end of the node doesn't map to the
          // actual position of the merge. Currently the inserted content is inserted at the start or end
          // of the merged content, TODO reverse the start/end when end/start token?
          let insertPos = mergeStartNode ? nodeEnd - openStart : offsetPos + openEnd
          if (node.isText) {
            // When merging text we must delete text in the same go as well, as the from/to boundary goes through
            // the text node.
            insertPos = deleteTextIfInserted(
              node,
              offsetPos,
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
                trackUtils.createNewInsertAttrs(trackAttrs),
                schema
              )
            )
          }
          // Okay this is a bit ridiculous but it's used to adjust the insert pos when track changes prevents deletions
          // of merged nodes & content, as just using mapped toA in that case isn't the same.
          // The calculation is a bit mysterious, I admit.
          // TODO delete/fix this?
          // 'should prevent replacing of blockquotes and break the slice into parts instead' test needs this
          // if (node.isText) {
          //   mergedInsertPos = offsetPos - openEnd
          // }
        } else if (node.isText) {
          // Text deletion is handled even when the deletion doesn't completely wrap the text node
          // (which is basically the case most of the time)
          deleteTextIfInserted(node, offsetPos, newTr, schema, deleteAttrs, offsetFrom, offsetTo)
        } else if (startTokenDeleted) {
          // TODO while technically correct to delete a node which has its start token deleted, it's a lot more
          // difficult to determine merging of content. For example, if inserted blockquote's start token was deleted
          // and subsequently, removed from the doc _but_ a new blockquote with fully open end was inserted at its place.
          // Then merging, as it's currently implemented, would fail as it expects the old blockquote to be present.
          // To improve this the merging would have to be omitted and the whole inserted slice be inserted with openEnd=0.
          // deleteOrSetNodeDeleted(node, offsetPos, newTr, deleteAttrs)
        }
      } else if (nodeCompletelyDeleted) {
        deleteOrSetNodeDeleted(node, offsetPos, newTr, deleteAttrs)
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
