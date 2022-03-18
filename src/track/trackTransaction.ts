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
import {
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

import { logger } from '../utils/logger'
import { CHANGE_OPERATION, CHANGE_STATUS, TrackedAttrs } from '../types/change'
import { ExposedFragment, ExposedReplaceStep, ExposedSlice } from '../types/pm'
import { DeleteAttrs, InsertAttrs, UserData } from '../types/track'
import {
  addTrackIdIfDoesntExist,
  getMergeableMarkTrackedAttrs,
  shouldMergeTrackedAttributes,
} from './node-utils'

function markInlineNodeChange(
  node: PMNode<any>,
  insertAttrs: InsertAttrs,
  userColors: UserData,
  schema: Schema
) {
  const filtered = node.marks.filter(
    (m) => m.type !== schema.marks.tracked_insert && m.type !== schema.marks.tracked_delete
  )
  const mark =
    insertAttrs.operation === CHANGE_OPERATION.insert
      ? schema.marks.tracked_insert
      : schema.marks.tracked_delete
  const pending_bg =
    insertAttrs.operation === CHANGE_OPERATION.insert
      ? userColors.insertColor
      : userColors.deleteColor
  const createdMark = mark.create({
    dataTracked: addTrackIdIfDoesntExist(insertAttrs),
    pending_bg,
  })
  return node.mark(filtered.concat(createdMark))
}

function recurseContent(
  node: PMNode<any>,
  insertAttrs: InsertAttrs,
  userColors: UserData,
  schema: Schema
) {
  if (node.isText) {
    return markInlineNodeChange(node, insertAttrs, userColors, schema)
  } else if (node.isBlock || node.isInline) {
    const updatedChildren: PMNode[] = []
    node.content.forEach((child) => {
      updatedChildren.push(recurseContent(child, insertAttrs, userColors, schema))
    })
    return node.type.create(
      {
        ...node.attrs,
        dataTracked: addTrackIdIfDoesntExist(insertAttrs),
      },
      Fragment.fromArray(updatedChildren),
      node.marks
    )
  } else {
    logger(`%c ERROR Unhandled node type: "${node.type.name}"`, 'color: #ff4242', node)
    return node
  }
}

function setFragmentAsInserted(
  inserted: Fragment,
  insertAttrs: InsertAttrs,
  userColors: UserData,
  schema: Schema
) {
  // Recurse the content in the inserted slice and either mark it tracked_insert or set node attrs
  const updatedInserted: PMNode[] = []
  inserted.forEach((n) => {
    updatedInserted.push(recurseContent(n, insertAttrs, userColors, schema))
  })
  return updatedInserted.length === 0 ? inserted : Fragment.fromArray(updatedInserted)
}

/**
 * Merges tracked marks between text nodes at a position
 *
 * Will merge any nodes that have tracked attributes so should work for inline or block nodes also.
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
    time: Math.max(leftAttrs.time || 0, rightAttrs.time || 0) || Date.now(),
  }
  const fromStartOfMark = pos - nodeBefore.nodeSize
  const toEndOfMark = pos + nodeAfter.nodeSize
  newTr.addMark(fromStartOfMark, toEndOfMark, leftMark.type.create(newAttrs))
}

/**
 * Applies marks between from and to, joining adjacent marks if they share same operation and user id
 *
 * @deprecated
 * @param from
 * @param to
 * @param doc
 * @param newTr
 * @param schema
 * @param addedAttrs
 * @param userColors
 * @returns
 */
export function applyAndMergeMarks(
  from: number,
  to: number,
  doc: PMNode,
  newTr: Transaction,
  schema: Schema,
  addedAttrs: InsertAttrs | DeleteAttrs,
  userColors: UserData
) {
  if (from === to) {
    return
  }
  let leftMarks: Partial<TrackedAttrs> | null | undefined,
    leftNode: PMNode<any> | null | undefined,
    rightMarks: Partial<TrackedAttrs> | null | undefined,
    rightNode: PMNode<any> | null | undefined

  // Removes old marks
  // TODO -> or dont? incase we want to persist the original author
  // makes things a lot more complicated though
  newTr.removeMark(from, to, schema.marks.tracked_insert)
  newTr.removeMark(from, to, schema.marks.tracked_delete)
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isInline) {
      const firstInlineNode = from >= pos
      const lastInlineNode = pos + node.nodeSize >= to
      if (firstInlineNode) {
        leftNode = doc.resolve(Math.max(pos, from)).nodeBefore
        leftMarks = getMergeableMarkTrackedAttrs(leftNode, addedAttrs, schema)
      }
      if (lastInlineNode) {
        rightNode = doc.resolve(Math.min(pos + node.nodeSize, to)).nodeAfter
        rightMarks = getMergeableMarkTrackedAttrs(rightNode, addedAttrs, schema)
      }
      const fromStartOfMark = from - (leftNode && leftMarks ? leftNode.nodeSize : 0)
      const toEndOfMark = to + (rightNode && rightMarks ? rightNode.nodeSize : 0)
      const dataTracked = addTrackIdIfDoesntExist({
        ...leftMarks,
        ...rightMarks,
        ...addedAttrs,
      })
      const mark =
        addedAttrs.operation === CHANGE_OPERATION.insert
          ? schema.marks.tracked_insert
          : schema.marks.tracked_delete
      const pending_bg =
        addedAttrs.operation === CHANGE_OPERATION.insert
          ? userColors.insertColor
          : userColors.deleteColor

      newTr.addMark(
        fromStartOfMark,
        toEndOfMark,
        mark.create({
          dataTracked,
          pending_bg,
        })
      )

      leftMarks = null
      rightMarks = null
    }
  })
}

/**
 * Either deletes a block node (if it was already inserted) or sets its status attribute to 'deleted'
 * @param node
 * @param pos
 * @param newTr
 * @param deleteAttrs
 */
function deleteNode(node: PMNode, pos: number, newTr: Transaction, deleteAttrs: DeleteAttrs) {
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

function deleteInlineIfInserted(
  node: PMNode,
  pos: number,
  newTr: Transaction,
  schema: Schema,
  deleteAttrs: DeleteAttrs,
  deleteColor: string,
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
        pending_bg: deleteColor,
      })
    )
  }
}

function getMergedNode(
  node: PMNode | null | undefined,
  currentDepth: number,
  depth: number,
  first: boolean
) {
  if (!node) {
    throw Error('getMergedNode failed to find node')
  }
  if (currentDepth === depth) {
    return {
      mergedContent: node.content,
      returnedSlice: undefined,
    }
  } else {
    const result: PMNode[] = []
    let merged
    node.content.forEach((n, _, i) => {
      if ((first && i === 0) || (!first && i === node.childCount - 1)) {
        const { mergedContent, returnedSlice } = getMergedNode(n, currentDepth + 1, depth, first)
        merged = mergedContent
        if (returnedSlice) {
          result.push(...returnedSlice.content)
        }
      } else {
        result.push(n)
      }
    })
    if (result.length > 0) {
      return {
        mergedContent: merged,
        returnedSlice: Fragment.fromArray(result) as ExposedFragment,
      }
    }
    return {
      mergedContent: merged,
      returnedSlice: undefined,
    }
  }
}

/**
 * Splits inserted slice from a copy-paste transaction into separate parts
 *
 * These parts can be then applied in subsequent iterations so instead of just applying
 * `<p>as|df</p><p>bye</p>|` we get two nodes: `[<p>df</p>,<p>bye</p>]`
 * @param insertSlice
 * @returns
 */
function splitSliceIntoMergedParts(insertSlice: ExposedSlice) {
  const { openStart, openEnd, content } = insertSlice
  const nodes: PMNode[] = content.content
  let updatedSliceNodes: PMNode[] | undefined
  const firstMergedNode =
    openStart > 0 && openStart !== openEnd
      ? getMergedNode(content.firstChild, 1, openStart, true)
      : undefined
  const lastMergedNode =
    openEnd > 0 && openStart !== openEnd
      ? getMergedNode(content.lastChild, 1, openEnd, false)
      : undefined
  if (firstMergedNode) {
    updatedSliceNodes = nodes.filter((_, i) => i !== 0)
    if (firstMergedNode.returnedSlice) {
      updatedSliceNodes = [...firstMergedNode.returnedSlice.content, ...updatedSliceNodes]
    }
  }
  if (lastMergedNode) {
    updatedSliceNodes = (updatedSliceNodes || nodes).filter(
      (_, i) => i + 1 !== (updatedSliceNodes || nodes).length
    )
    if (lastMergedNode.returnedSlice) {
      updatedSliceNodes = [...updatedSliceNodes, ...lastMergedNode.returnedSlice.content]
    }
  }
  return {
    updatedSliceNodes,
    firstMergedNode,
    lastMergedNode,
  }
}

export function deleteAndMergeSplitBlockNodes(
  from: number,
  to: number,
  startDoc: PMNode,
  newTr: Transaction,
  schema: Schema,
  deleteAttrs: DeleteAttrs,
  userColors: UserData,
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
  const insertStartDepth = startDoc.resolve(from).depth
  const insertEndDepth = startDoc.resolve(to).depth
  logger('deleteAndMergeSplitBlockNodes: updatedSliceNodes', updatedSliceNodes)
  startDoc.nodesBetween(from, to, (node, pos) => {
    const { pos: offsetPos, deleted: nodeWasDeleted } = deleteMap.mapResult(pos, 1)
    const offsetFrom = deleteMap.map(from, -1)
    const offsetTo = deleteMap.map(to, 1)
    const nodeEnd = offsetPos + node.nodeSize
    const step = newTr.steps[newTr.steps.length - 1]
    // Check node hasn't already been deleted by previous deleteNode eg blockquote deleting its children paragraphs
    if (nodeEnd > offsetFrom && !nodeWasDeleted) {
      // Delete touches this node
      if (node.isText) {
        deleteInlineIfInserted(
          node,
          offsetPos,
          newTr,
          schema,
          deleteAttrs,
          userColors.deleteColor,
          offsetFrom,
          offsetTo
        )
      } else if (node.isBlock) {
        if (offsetPos >= offsetFrom && nodeEnd <= offsetTo) {
          // Block node deleted completely
          deleteNode(node, offsetPos, newTr, deleteAttrs)
        } else if (nodeEnd > offsetFrom && nodeEnd <= offsetTo) {
          // The end token deleted: <p>asdf|</p><p>bye</p>| + [<p>] hello</p> -> <p>asdf hello</p>
          // How about <p>asdf|</p><p>|bye</p> + [<p>] hello</p><p>good[</p>] -> <p>asdf hello</p><p>goodbye</p>
          // This doesn't work at least: <p>asdf|</p><p>|bye</p> + empty -> <p>asdfbye</p>
          // Depth + 1 because the original pos was at text level(?) and we always want to insert at the correct
          // block level therefore we increment the depth. Or something like that. Does work though.
          const depth = newTr.doc.resolve(offsetPos).depth + 1
          // Pick stuff only if the slice requires it (has openStart > 0)
          // Otherwise it's just a regular delete that tries to join two same level blocks, probably paragraphs
          // Which doesn't effect the start paragraph (with the delete end token) in either way
          if (
            insertSlice.openStart > 0 &&
            depth === insertStartDepth &&
            firstMergedNode?.mergedContent
          ) {
            // const insertedNode = getBlockNodeAtDepth(insertSlice.content, 1, depth, true)
            // updatedSliceNodes = content.filter((_, i) => i !== 0)
            newTr.insert(
              nodeEnd - 1,
              setFragmentAsInserted(
                firstMergedNode.mergedContent,
                {
                  ...deleteAttrs,
                  operation: CHANGE_OPERATION.insert,
                },
                userColors,
                schema
              )
            )
          }
        } else if (offsetPos >= offsetFrom && nodeEnd - 1 > offsetTo) {
          // The start token deleted: |<p>hey</p><p>|asdf</p> + <p>hello [</p>] -> <p>hello asdf</p>
          // Gosh the depth... Ainakin sliceen ekan? sitten tsekkaan mikä syvyys
          // Ainakin syvin tulee ekana joten pitäis olla samassa tasossa
          // pickFirst at depth?
          const depth = newTr.doc.resolve(offsetPos).depth + 1
          // Same as before, pick stuff to be inserted only if there slice needs it
          // But in this case, contrary to deleted end token, we'll set the block node as deleted
          // To join the contents to whatever content is above if this change is accepted.
          if (
            insertSlice.openEnd > 0 &&
            depth === insertEndDepth &&
            lastMergedNode?.mergedContent
          ) {
            // Just as a future reminder, inserting text at paragraph position wraps into into a new paragraph...
            // So you need to offset it by 1 to insert it _inside_ the paragraph
            newTr.insert(
              offsetPos + 1,
              setFragmentAsInserted(
                lastMergedNode.mergedContent,
                {
                  ...deleteAttrs,
                  operation: CHANGE_OPERATION.insert,
                },
                userColors,
                schema
              )
            )
            mergedInsertPos = offsetPos
          } else if (insertSlice.openStart === insertSlice.openEnd) {
            deleteNode(node, offsetPos, newTr, deleteAttrs)
          }
        }
      } else if (!nodeWasDeleted) {
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
      : insertSlice.content, // The new insert slice from which all deleted content has been removed
  }
}

const getSelectionStaticCreate = (sel: Selection, doc: PMNode, from: number) =>
  Object.getPrototypeOf(sel).constructor.create(doc, from)

/**
 * Applies and immediately inverts transactions to wrap their contents/operations with track data instead
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
 * @param userData User data
 * @returns newTr that inverts the initial tr and applies track attributes/marks
 */
export function trackTransaction(
  tr: Transaction,
  oldState: EditorState,
  newTr: Transaction,
  userData: UserData
) {
  const defaultAttrs: Omit<TrackedAttrs, 'id' | 'operation'> = {
    userID: userData.userID,
    userName: userData.userName,
    time: tr.time,
    status: CHANGE_STATUS.pending,
  }
  const insertAttrs: InsertAttrs = {
    ...defaultAttrs,
    operation: CHANGE_OPERATION.insert,
  }
  const deleteAttrs: DeleteAttrs = {
    ...defaultAttrs,
    operation: CHANGE_OPERATION.delete,
  }
  // Must use constructor.name instead of instanceof as aliasing prosemirror-state is a lot more
  // difficult than prosemirror-transform
  const wasNodeSelection = tr.selection.constructor.name === 'NodeSelection'
  let iters = 0
  logger('ORIGINAL transaction', tr)
  tr.steps.forEach((step) => {
    logger('transaction step', step)
    if (iters > 10) {
      console.error('Possible infinite loop in trackTransaction!', newTr)
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
        logger(`changed ranges: ${fromA} ${toA} ${fromB} ${toB}`)
        const { slice } = step as ExposedReplaceStep
        // Invert the transaction step to prevent it from actually deleting or inserting anything
        const newStep = step.invert(oldState.doc)
        const stepResult = newTr.maybeStep(newStep)
        if (stepResult.failed) {
          logger(
            `%c ERROR invert ReplaceStep failed: "${stepResult.failed}"`,
            'color: #ff4242',
            newStep
          )
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
          userData,
          slice
        )
        logger('TR: new steps after applying delete', [...newTr.steps])
        const toAWithOffset = mergedInsertPos ?? deleteMap.map(toA)
        if (newSliceContent.size > 0) {
          logger('newSliceContent', newSliceContent)
          // Since deleteAndMergeSplitBlockNodes modified the slice to not to contain any partial slices,
          // the new slice should contain only complete nodes therefore the depths should be equal
          const openStart = slice.openStart !== slice.openEnd ? 0 : slice.openStart
          const openEnd = slice.openStart !== slice.openEnd ? 0 : slice.openEnd
          const insertedSlice = new Slice(
            setFragmentAsInserted(newSliceContent, insertAttrs, userData, oldState.schema),
            openStart,
            openEnd
          )
          const newStep = new ReplaceStep(toAWithOffset, toAWithOffset, insertedSlice)
          const stepResult = newTr.maybeStep(newStep)
          if (stepResult.failed) {
            logger(
              `%c ERROR insert ReplaceStep failed: "${stepResult.failed}"`,
              'color: #ff4242',
              newStep
            )
            return
          }
          logger('new steps after applying insert', [...newTr.steps])
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
        // Here somewhere do a check if adjacent insert & delete cancel each other out (matching their content char by char, not diffing)
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
      // } else if (step instanceof ReplaceAroundStep) {
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
  logger('NEW transaction', newTr)
  return newTr
}
