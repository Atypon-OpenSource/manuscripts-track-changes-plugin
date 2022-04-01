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
import type {
  EditorState,
  Selection,
  NodeSelection,
  TextSelection,
  Transaction,
} from 'prosemirror-state'
import {
  AddMarkStep,
  Mapping,
  RemoveMarkStep,
  ReplaceAroundStep,
  ReplaceStep,
  Step,
  StepMap,
} from 'prosemirror-transform'

import { log } from '../utils/logger'
import { CHANGE_OPERATION, CHANGE_STATUS, TrackedAttrs } from '../types/change'
import { ExposedFragment, ExposedReplaceStep, ExposedSlice } from '../types/pm'
import { NewDeleteAttrs, NewEmptyAttrs, NewInsertAttrs, NewTrackedAttrs } from '../types/track'
import {
  addTrackIdIfDoesntExist,
  getMergeableMarkTrackedAttrs,
  shouldMergeTrackedAttributes,
} from './node-utils'
import { trackReplaceAroundStep } from './replace-around-step/trackReplaceAroundStep'

function markInlineNodeChange(node: PMNode<any>, newTrackAttrs: NewTrackedAttrs, schema: Schema) {
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

function recurseNodeContent(node: PMNode<any>, newTrackAttrs: NewTrackedAttrs, schema: Schema) {
  if (node.isText) {
    return markInlineNodeChange(node, newTrackAttrs, schema)
  } else if (node.isBlock || node.isInline) {
    const updatedChildren: PMNode[] = []
    node.content.forEach((child) => {
      updatedChildren.push(recurseNodeContent(child, newTrackAttrs, schema))
    })
    return node.type.create(
      {
        ...node.attrs,
        dataTracked: addTrackIdIfDoesntExist(newTrackAttrs),
      },
      Fragment.fromArray(updatedChildren),
      node.marks
    )
  } else {
    log.error(`unhandled node type: "${node.type.name}"`, node)
    return node
  }
}

function setFragmentAsInserted(inserted: Fragment, insertAttrs: NewInsertAttrs, schema: Schema) {
  // Recurse the content in the inserted slice and either mark it tracked_insert or set node attrs
  const updatedInserted: PMNode[] = []
  inserted.forEach((n) => {
    updatedInserted.push(recurseNodeContent(n, insertAttrs, schema))
  })
  return updatedInserted.length === 0 ? inserted : Fragment.fromArray(updatedInserted)
}

/**
 * Merges tracked marks between text nodes at a position
 *
 * Will work for any nodes that use tracked_insert or tracked_delete marks which may not be preferrable
 * if used for block nodes (since we possibly want to show the individual changed nodes).
 * Merging is done based on the userID, operation type and status.
 * @param pos
 * @param doc
 * @param newTr
 * @param schema
 */
function mergeTrackedMarks(pos: number, doc: PMNode, newTr: Transaction, schema: Schema) {
  const resolved = doc.resolve(pos)
  const { nodeAfter, nodeBefore } = resolved
  const leftMark = nodeBefore?.marks.filter(
    (m) => m.type === schema.marks.tracked_insert || m.type === schema.marks.tracked_delete
  )[0]
  const rightMark = nodeAfter?.marks.filter(
    (m) => m.type === schema.marks.tracked_insert || m.type === schema.marks.tracked_delete
  )[0]
  if (!nodeAfter || !nodeBefore || !leftMark || !rightMark || leftMark.type !== rightMark.type) {
    return
  }
  const leftAttrs = leftMark.attrs
  const rightAttrs = rightMark.attrs
  if (!shouldMergeTrackedAttributes(leftAttrs.dataTracked, rightAttrs.dataTracked)) {
    return
  }
  const newAttrs = {
    ...leftAttrs,
    createdAt: Math.max(leftAttrs.createdAt || 0, rightAttrs.createdAt || 0) || Date.now(),
  }
  const fromStartOfMark = pos - nodeBefore.nodeSize
  const toEndOfMark = pos + nodeAfter.nodeSize
  newTr.addMark(fromStartOfMark, toEndOfMark, leftMark.type.create(newAttrs))
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
function splitSliceIntoMergedParts(insertSlice: ExposedSlice) {
  const {
    openStart,
    openEnd,
    content: { firstChild, lastChild, content: nodes },
  } = insertSlice
  let updatedSliceNodes = nodes
  const firstMergedNode =
    openStart > 0 && openStart !== openEnd && firstChild
      ? getMergedNode(firstChild, 1, openStart, true)
      : undefined
  const lastMergedNode =
    openEnd > 0 && openStart !== openEnd && lastChild
      ? getMergedNode(lastChild, 1, openEnd, false)
      : undefined
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
 * @param startDoc doc before the deletion
 * @param newTr the new track transaction
 * @param schema ProseMirror schema
 * @param deleteAttrs attributes for the dataTracked object
 * @param insertSlice the inserted slice from ReplaceStep
 * @returns mapping adjusted by the applied operations & modified insert slice
 */
export function deleteAndMergeSplitBlockNodes(
  from: number,
  to: number,
  startDoc: PMNode,
  newTr: Transaction,
  schema: Schema,
  deleteAttrs: NewDeleteAttrs,
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
  const { updatedSliceNodes, firstMergedNode, lastMergedNode } =
    splitSliceIntoMergedParts(insertSlice)
  const insertStartDepth = insertSlice.openStart !== insertSlice.openEnd ? 0 : insertSlice.openStart
  const insertEndDepth = insertSlice.openStart !== insertSlice.openEnd ? 0 : insertSlice.openEnd
  startDoc.nodesBetween(from, to, (node, pos) => {
    const { pos: offsetPos, deleted: nodeWasDeleted } = deleteMap.mapResult(pos, 1)
    const offsetFrom = deleteMap.map(from, -1)
    const offsetTo = deleteMap.map(to, 1)
    const nodeEnd = offsetPos + node.nodeSize
    const step = newTr.steps[newTr.steps.length - 1]
    if (nodeEnd > offsetFrom && !nodeWasDeleted) {
      // nodeEnd > offsetFrom -> delete touches this node
      // eg (del 6 10) <p 5>|<t 6>cdf</t 9></p 10>| -> <p> nodeEnd 10 > from 6
      //
      // !nodeWasDeleted -> Check node wasn't already deleted by a previous deleteNode
      // This is quite tricky to wrap your head around and I've forgotten the nitty-gritty details already.
      // But from what I remember what it safeguards against is, when you've already deleted a node
      // say an inserted blockquote that had all its children deleted, nodesBetween still iterates over those
      // nodes and therefore we have to make this check to ensure they still exist in the doc.
      if (node.isText) {
        deleteTextIfInserted(node, offsetPos, newTr, schema, deleteAttrs, offsetFrom, offsetTo)
      } else if (node.isBlock) {
        if (offsetPos >= offsetFrom && nodeEnd <= offsetTo) {
          // |<p>asdf</p>| -> block node deleted completely
          deleteNode(node, offsetPos, newTr, deleteAttrs)
        } else if (nodeEnd > offsetFrom && nodeEnd <= offsetTo) {
          // The end token deleted eg:
          // <p 1>asdf|</p 7><p 7>bye</p 12>| + [<p>]hello</p> -> <p>asdfhello</p>
          // (del 6 12) + (ins [<p>]hello</p> openStart 1 openEnd 0)
          // <p> nodeEnd 7 > from 6 && nodeEnd 7 <= to 12
          //
          // How about
          // <p 1>asdf|</p 7><p 7>|bye</p 12> + [<p>]hello</p><p>good[</p>] -> <p>asdfhello</p><p>goodbye</p>
          //
          // What about:
          // <p 1>asdf|</p 7><p 7 op="inserted">|bye</p 12> + empty -> <p>asdfbye</p>
          //
          // Retrieve depth which is often 1 when merging paragraphs or 2 for fully open blockquotes.
          const depth = newTr.doc.resolve(offsetPos).depth
          // Insert inside a merged node only if the slice was open (openStart > 0) and there exists mergedNodeContent.
          // Then we only have to ensure the depth is at the right level, so say a fully open blockquote insert will
          // be merged at the lowest, paragraph level, instead of blockquote level.
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
          // The start token deleted eg:
          // |<p 1>hey</p 6><p 6>|asdf</p 12> + <p>hello [</p>] -> <p>hello asdf</p>
          // (del 1 7) + (ins <p>hello [</p>] openStart 0 openEnd 1)
          // <p> pos 6 >= from 1 && nodeEnd 12 - 1 > to 7
          const depth = newTr.doc.resolve(offsetPos).depth
          // Same as above, merge nodes manually if there exists an open slice with mergeable content.
          // Compared to deleting an end token however, the merged block node is set as deleted. This is due to
          // ProseMirror node semantics as start tokens are considered to contain the actual node itself.
          if (
            insertSlice.openEnd > 0 &&
            depth === insertEndDepth &&
            lastMergedNode?.mergedNodeContent
          ) {
            // Just as a fun fact that I found out while debugging this. Inserting text at paragraph position wraps
            // it into a new paragraph(!). So that's why you always offset your positions to insert it _inside_
            // the paragraph.
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
            mergedInsertPos = offsetPos
          } else if (insertSlice.openStart === insertSlice.openEnd) {
            // Incase the slice was fully open and the previous conditions didn't apply,
            // just delete it as normally. TODO when does this trigger?
            deleteNode(node, offsetPos, newTr, deleteAttrs)
          }
        }
      } else if (!nodeWasDeleted) {
        // So if the node was not text nor a block, the remaining option is an inline node.
        // Which is deleted normally.
        deleteNode(node, offsetPos, newTr, deleteAttrs)
      }
    }
    const newestStep = newTr.steps[newTr.steps.length - 1]
    if (step !== newestStep) {
      // New step added
      deleteMap.appendMap(newestStep.getMap())
    }
  })
  return {
    deleteMap, // Mapping to adjust the positions for the insert position tracking
    mergedInsertPos,
    newSliceContent: updatedSliceNodes
      ? Fragment.fromArray(updatedSliceNodes)
      : insertSlice.content, // The new insert slice with all the merged content having been removed
  }
}

/**
 * Retrieves a static property from Selection class instead of having to use direct imports
 *
 * This skips the direct dependency to prosemirror-state where multiple versions might cause conflicts
 * as the created instances might belong to different prosemirror-state import than one used in the editor.
 * @param sel
 * @param doc
 * @param from
 * @returns
 */
const getSelectionStaticCreate = (sel: Selection, doc: PMNode, from: number) =>
  Object.getPrototypeOf(sel).constructor.create(doc, from)

/**
 * Inverts transactions to wrap their contents/operations with track data instead
 *
 * The main function of track changes that holds the most complex parts of this whole library.
 * Takes in as arguments the data from appendTransaction to reapply it with the track marks/attributes.
 * We could prevent the initial transaction from being applied all together but since invert works just
 * as well and we can use the intermediate doc for checking which nodes are changed, it's not prevented.
 *
 *
 * @param tr Original transaction
 * @param oldState State before transaction
 * @param newTr Transaction created from the new editor state
 * @param userID User id
 * @returns newTr that inverts the initial tr and applies track attributes/marks
 */
export function trackTransaction(
  tr: Transaction,
  oldState: EditorState,
  newTr: Transaction,
  userID: string
) {
  const emptyAttrs: NewEmptyAttrs = {
    userID,
    createdAt: tr.time,
    status: CHANGE_STATUS.pending,
  }
  const insertAttrs: NewInsertAttrs = {
    ...emptyAttrs,
    operation: CHANGE_OPERATION.insert,
  }
  const deleteAttrs: NewDeleteAttrs = {
    ...emptyAttrs,
    operation: CHANGE_OPERATION.delete,
  }
  // Must use constructor.name instead of instanceof as aliasing prosemirror-state is a lot more
  // difficult than prosemirror-transform
  const wasNodeSelection = tr.selection.constructor.name === 'NodeSelection'
  let iters = 0
  log.info('ORIGINAL transaction', tr)
  tr.steps.forEach((step) => {
    log.info('transaction step', step)
    if (iters > 20) {
      console.error(
        'Possible infinite loop in track-changes-plugin trackTransaction, tracking skipped!'
      )
      console.error(
        'This is probably an error with the library, please report back to maintainers with a reproduction if possible',
        newTr
      )
      return
    }
    iters += 1
    const multipleTransforms =
      !(step instanceof ReplaceStep) && step.constructor.name === 'ReplaceStep'
    if (multipleTransforms) {
      throw new Error(
        'Multiple prosemirror-transform packages imported, alias/dedupe them or instanceof checks fail'
      )
    }
    if (step instanceof ReplaceStep) {
      step.getMap().forEach((fromA: number, toA: number, fromB: number, toB: number) => {
        log.info(`changed ranges: ${fromA} ${toA} ${fromB} ${toB}`)
        const { slice } = step as ExposedReplaceStep
        // Invert the transaction step to prevent it from actually deleting or inserting anything
        const newStep = step.invert(oldState.doc)
        const stepResult = newTr.maybeStep(newStep)
        if (stepResult.failed) {
          log.error(`invert ReplaceStep failed: "${stepResult.failed}"`, newStep)
          return
        }
        // First apply the deleted range and update the insert slice to not include content that was deleted,
        // eg partial nodes in an open-ended slice
        const { deleteMap, mergedInsertPos, newSliceContent } = deleteAndMergeSplitBlockNodes(
          fromA,
          toA,
          oldState.doc,
          newTr,
          oldState.schema,
          deleteAttrs,
          slice
        )
        log.info('TR: new steps after applying delete', [...newTr.steps])
        const toAWithOffset = mergedInsertPos ?? deleteMap.map(toA)
        if (newSliceContent.size > 0) {
          log.info('newSliceContent', newSliceContent)
          // Since deleteAndMergeSplitBlockNodes modified the slice to not to contain any merged nodes,
          // the sides should be equal. TODO can they be other than 0?
          const openStart = slice.openStart !== slice.openEnd ? 0 : slice.openStart
          const openEnd = slice.openStart !== slice.openEnd ? 0 : slice.openEnd
          const insertedSlice = new Slice(
            setFragmentAsInserted(newSliceContent, insertAttrs, oldState.schema),
            openStart,
            openEnd
          )
          const newStep = new ReplaceStep(toAWithOffset, toAWithOffset, insertedSlice)
          const stepResult = newTr.maybeStep(newStep)
          if (stepResult.failed) {
            log.error(`insert ReplaceStep failed: "${stepResult.failed}"`, newStep)
            return
          }
          log.info('new steps after applying insert', [...newTr.steps])
          mergeTrackedMarks(toAWithOffset, newTr.doc, newTr, oldState.schema)
          mergeTrackedMarks(toAWithOffset + insertedSlice.size, newTr.doc, newTr, oldState.schema)
          if (!wasNodeSelection) {
            newTr.setSelection(
              getSelectionStaticCreate(tr.selection, newTr.doc, toAWithOffset + insertedSlice.size)
            )
          }
        } else {
          // Incase only deletion was applied, check whether tracked marks around deleted content can be merged
          mergeTrackedMarks(toAWithOffset, newTr.doc, newTr, oldState.schema)
          if (!wasNodeSelection) {
            newTr.setSelection(getSelectionStaticCreate(tr.selection, newTr.doc, fromA))
          }
        }
        // TODO: here we could check whether adjacent inserts & deletes cancel each other out.
        // However, this should not be done by diffing and only matching node or char by char instead since
        // it's A easier and B more intuitive to user.
        const { meta } = tr as Transaction & {
          meta: Record<string, any>
        }
        // This is quite non-optimal in some sense but to ensure no information is lost
        // we have to re-add all the old meta keys, such as inputType or uiEvent.
        // This should prevent bugs incase other plugins/widgets rely upon them existing (and they
        // are not able to process the transactions before track-changes).
        // TODO: will this cause race-condition if a meta causes another appendTransaction to fire
        Object.keys(meta).forEach((key) => newTr.setMeta(key, tr.getMeta(key)))
      })
    } else if (step instanceof ReplaceAroundStep) {
      trackReplaceAroundStep(step, oldState, newTr, emptyAttrs)
    }
  })
  // This is kinda hacky solution at the moment to maintain NodeSelections over transactions
  // These are required by at least cross-references that need it to activate the selector pop-up
  if (wasNodeSelection) {
    const mappedPos = newTr.mapping.map(tr.selection.from)
    const resPos = newTr.doc.resolve(mappedPos)
    const nodePos = mappedPos - (resPos.nodeBefore?.nodeSize || 0)
    newTr.setSelection(getSelectionStaticCreate(tr.selection, newTr.doc, nodePos))
  }
  log.info('NEW transaction', newTr)
  return newTr
}
