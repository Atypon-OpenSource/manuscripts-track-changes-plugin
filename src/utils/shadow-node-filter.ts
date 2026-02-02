/*!
 * © 2023 Atypon Systems LLC
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

import { isShadowDelete } from '../tracking/steps-trackers/qualifiers'

// Store original methods to restore later
let originalDescendants: typeof PMNode.prototype.descendants | null = null
let originalNodesBetween: typeof PMNode.prototype.nodesBetween | null = null
let originalForEach: typeof PMNode.prototype.forEach | null = null

/**
 * Enhanced descendants method that filters out shadow content
 */
function shadowFilteredDescendants(
  this: PMNode,
  callback: (node: PMNode, pos: number, parent: PMNode, index: number) => boolean | void,
  startPos = 0
): void {
  // Call original descendants with our filtering wrapper
  originalDescendants!.call(this, (node, pos, parent, index) => {
    // If this is a shadow delete node, skip it and all its descendants
    if (isShadowDelete(node)) {
      return false
    }

    // If node passes filter, call the original callback
    return callback(node, pos, parent, index)
  }, startPos)
}

/**
 * Enhanced nodesBetween method that filters out shadow content
 */
function shadowFilteredNodesBetween(
  this: PMNode,
  from: number,
  to: number,
  callback: (node: PMNode, pos: number, parent: PMNode, index: number) => boolean | void,
  startPos = 0
): void {
  originalNodesBetween!.call(this, from, to, (node, pos, parent, index) => {
    // If this is a shadow delete node, skip it and all its descendants
    if (isShadowDelete(node)) {
      return false
    }

    // If node passes filter, call the original callback
    return callback(node, pos, parent, index)
  }, startPos)
}

/**
 * Enhanced forEach method that filters out shadow content
 */
function shadowFilteredForEach(
  this: PMNode,
  callback: (node: PMNode, offset: number, index: number) => void
): void {
  if (!originalForEach) return
  
  originalForEach.call(this, (node, offset, index) => {
    // Skip shadow delete nodes
    if (isShadowDelete(node)) {
      return
    }
    
    callback(node, offset, index)
  })
}

/**
 * Installs shadow content filtering on ProseMirror Node prototype
 * This makes shadow content invisible to all document traversal
 */
export function installShadowNodeFilter(): void {
  // Only install once
  if (originalDescendants !== null) {
    return
  }

  // Store original methods
  originalDescendants = PMNode.prototype.descendants
  originalNodesBetween = PMNode.prototype.nodesBetween
  originalForEach = PMNode.prototype.forEach

  // Install filtered versions
  PMNode.prototype.descendants = shadowFilteredDescendants
  PMNode.prototype.nodesBetween = shadowFilteredNodesBetween
  if (originalForEach) {
    PMNode.prototype.forEach = shadowFilteredForEach
  }
}

/**
 * Removes shadow content filtering and restores original ProseMirror Node methods
 * This is useful for cleanup or debugging
 */
export function uninstallShadowNodeFilter(): void {
  if (originalDescendants === null) {
    return
  }

  // Restore original methods
  PMNode.prototype.descendants = originalDescendants
  PMNode.prototype.nodesBetween = originalNodesBetween
  if (originalForEach) {
    PMNode.prototype.forEach = originalForEach
  }

  // Clear references
  originalDescendants = null
  originalNodesBetween = null
  originalForEach = null
}

/**
 * Checks if shadow node filtering is currently installed
 */
export function isShadowNodeFilterInstalled(): boolean {
  return originalDescendants !== null
}

/**
 * Temporarily disables shadow filtering for a callback function
 * Useful when you need to access shadow nodes for internal operations
 */
export function withoutShadowFilter<T>(callback: () => T): T {
  const wasInstalled = isShadowNodeFilterInstalled()
  
  if (wasInstalled) {
    uninstallShadowNodeFilter()
  }
  
  try {
    return callback()
  } finally {
    if (wasInstalled) {
      installShadowNodeFilter()
    }
  }
}

/**
 * Direct utility to check if a node would be filtered by shadow filtering
 * Useful for debugging or conditional logic
 */
export function isNodeShadowFiltered(node: PMNode): boolean {
  return isShadowDelete(node)
}