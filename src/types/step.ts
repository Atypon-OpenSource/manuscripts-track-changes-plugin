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
import { Node as PMNode } from 'prosemirror-model'
import { ExposedFragment, ExposedSlice } from './pm'

export interface DeleteNodeStep {
  pos: number
  nodeEnd: number
  type: 'delete-node'
  node: PMNode
}
export interface DeleteTextStep {
  pos: number
  from: number
  to: number
  type: 'delete-text'
  node: PMNode
}
export interface MergeFragmentStep {
  pos: number
  mergePos: number
  from: number
  to: number
  type: 'merge-fragment'
  node: PMNode
  fragment: ExposedFragment
}
export interface InsertSliceStep {
  from: number
  to: number
  sliceWasSplit: boolean
  type: 'insert-slice'
  slice: ExposedSlice
}
export interface UpdateNodeAttrsStep {
  pos: number
  type: 'update-node-attrs'
  node: PMNode
  newAttrs: Record<string, any>
}
export type ChangeStep =
  | DeleteNodeStep
  | DeleteTextStep
  | MergeFragmentStep
  | InsertSliceStep
  | UpdateNodeAttrsStep
