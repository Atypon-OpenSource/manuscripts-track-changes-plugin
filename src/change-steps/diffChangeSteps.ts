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

import { matchInserted } from './matchInserted'
import { log } from '../utils/logger'
import { ExposedFragment, ExposedSlice } from '../types/pm'
import { ChangeStep, InsertSliceStep } from '../types/step'

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
      if (deleted - matched > 0) {
        newContent.push(child.cut(deleted - matched))
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
    const deleteStart = updatedDeleted.reduce((acc, cur) => {
      if (cur.type === 'delete-node') {
        return Math.min(acc, cur.pos)
      } else if (cur.type === 'delete-text') {
        return Math.min(acc, cur.from)
      }
      return acc
    }, Number.MAX_SAFE_INTEGER)
    const [matchedDeleted, updatedDel] = matchInserted(deleteStart, updatedDeleted, ins.slice.content)
    if (matchedDeleted === deleteStart) {
      updated.push(ins)
      return
    }
    updatedDeleted = updatedDel
    const [_, newInserted] = cutFragment(0, matchedDeleted - deleteStart, ins.slice.content)
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
