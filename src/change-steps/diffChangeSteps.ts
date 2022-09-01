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
import type { Transaction } from 'prosemirror-state'

import { log } from '../utils/logger'
import { ExposedFragment, ExposedSlice } from '../types/pm'
import { ChangeStep, DeleteNodeStep, DeleteTextStep, InsertSliceStep } from '../types/step'

export function matchInserted(
  matchedDeleted: number,
  deleted: ChangeStep[],
  inserted: ExposedFragment,
  newTr: Transaction,
  schema: Schema
): [number, ChangeStep[]] {
  let matched: [number, ChangeStep[]] = [matchedDeleted, deleted]
  for (let i = 0; ; i += 1) {
    if (inserted.childCount === i) return matched
    const insNode = inserted.child(i)
    // @ts-ignore
    let adjDeleted: DeleteTextStep | DeleteNodeStep | undefined = matched[1].find(
      (d) =>
        (d.type === 'delete-text' && Math.max(d.pos, d.from) === matched[0]) ||
        (d.type === 'delete-node' && d.pos === matched[0])
    )
    if (insNode.type !== adjDeleted?.node?.type) {
      return matched
    } else if (insNode.isText && adjDeleted?.node) {
      adjDeleted = adjDeleted as DeleteTextStep
      const { pos, from, to, node: delNode } = adjDeleted
      let j = 0,
        d = from - pos,
        maxSteps = to - Math.max(pos, from)
      // Match text inside the inserted text node to the deleted text node
      for (
        ;
        maxSteps !== j && insNode.text![j] !== undefined && insNode.text![j] === delNode.text![d];
        j += 1, d += 1
      ) {
        matched[0] += 1
      }
      // this is needed incase diffing tr.doc
      // deleted.push({
      //   pos: pos,
      //   type: 'update-node-attrs',
      //   // Should check the attrs for equality in fixInconsistentChanges? to remove dataTracked completely
      //   oldAttrs: adjDeleted.node.attrs || {},
      //   newAttrs: child.attrs || {},
      // })
      matched = [matched[0], matched[1].filter((d) => d !== adjDeleted)]
      if (maxSteps !== j) {
        matched[1].push({
          pos,
          from: Math.max(pos, from) + j,
          to,
          type: 'delete-text',
          node: delNode,
        })
        return matched
      }
      continue
    } else if (insNode.content.size > 0 || adjDeleted?.node.content.size > 0) {
      // Move the inDeleted inside the block/inline node's boundary
      matched = matchInserted(
        matched[0] + 1,
        matched[1].filter((d) => d !== adjDeleted),
        insNode.content as ExposedFragment,
        newTr,
        schema
      )
    } else {
      matched = [matched[0] + insNode.nodeSize, matched[1].filter((d) => d !== adjDeleted)]
    }
    matched[1].push({
      pos: adjDeleted.pos,
      type: 'update-node-attrs',
      node: adjDeleted.node,
      // Should check the attrs for equality in fixInconsistentChanges? to remove dataTracked completely
      newAttrs: insNode.attrs || {},
    })
  }
}

/**
 * Cuts a fragment similar to Fragment.cut but also removes the parent node.
 *
 * @TODO there is however, some silly calculation mistake so that I need to use matched - deleted + 1 > 0
 * inside it to check whether to actually cut a text node. The offset might be cascading, therefore it should
 * be fixed at some point.
 * @param matched
 * @param deleted
 * @param content
 * @returns
 */
function cutFragment(matched: number, deleted: number, content: Fragment) {
  let newContent: PMNode[] = []
  for (let i = 0; matched <= deleted && i < content.childCount; i += 1) {
    const child = content.child(i)
    if (!child.isText && child.content.size > 0) {
      const cut = cutFragment(matched + 1, deleted, child.content)
      matched = cut[0]
      newContent.push(...cut[1].content)
    } else if (child.isText && matched + child.nodeSize > deleted) {
      if (matched - deleted + 1 > 0) {
        newContent.push(child.cut(0, matched - deleted + 1))
      } else {
        newContent.push(child)
      }
      matched = deleted + 1
    } else {
      matched += child.nodeSize
    }
  }
  return [matched, Fragment.fromArray(newContent)] as [number, ExposedFragment]
}

export function diffChangeSteps(
  deleted: ChangeStep[],
  inserted: InsertSliceStep[],
  newTr: Transaction,
  schema: Schema
) {
  const updated: ChangeStep[] = []
  let updatedDeleted = [...deleted]
  inserted.forEach((ins) => {
    log.info('DIFF ins ', ins)
    //
    // @TODO this is a temporary workaround to prevent duplicated diffing between splitSliceIntoMergedParts and
    // matchInserted.
    //
    // As originally authored splitSliceIntoMergedParts splits open slices into their merged parts
    // leaving out the need to insert the possibly deleted nodes into the doc. However, as matchInserted now
    // traverses the deleted range checking it against the inserted slice this behaves quite in a same way
    // where the opened block nodes are traversed but left unmodified. With an openStart > 0 though the
    // node-attr-updates would additionally have to be filtered out in the processChangeSteps.
    //
    // The old logic is still left as it's as refactoring is painful and would probably break something and just
    // in general, take a lot of time. Therefore, this sliceWasSplit boolean is used to just skip diffing.
    if (ins.sliceWasSplit) {
      updated.push(ins)
      return
    }
    // Start diffing from the start of the deleted range
    const deleteStart = deleted.reduce((acc, cur) => {
      if (cur.type === 'delete-node') {
        return Math.min(acc, cur.pos)
      } else if (cur.type === 'delete-text') {
        return Math.min(acc, cur.from)
      }
      return acc
    }, Number.MAX_SAFE_INTEGER)
    const [inDeleted, updatedDel] = matchInserted(
      deleteStart,
      updatedDeleted,
      ins.slice.content,
      newTr,
      schema
    )
    if (inDeleted === deleteStart) {
      updated.push(ins)
      return
    }
    updatedDeleted = updatedDel
    const newInserted = cutFragment(0, inDeleted, ins.slice.content)[1]
    if (newInserted.size > 0) {
      updated.push({
        ...ins,
        slice: new Slice(newInserted, ins.slice.openStart, ins.slice.openEnd) as ExposedSlice,
      })
    }
  })
  log.info('FINISH DIFF: ', [...updatedDeleted, ...updated])
  return [...updatedDeleted, ...updated]
}
