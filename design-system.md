# Editorial Palette Research: Style Guide

This document outlines the design philosophy, typography, and color theory behind the **Chroma Studio** interface exploration.

## 1. Color Palette

The interface relies on a highly restricted, high-contrast palette consisting of a pure white foundation, stark black structural lines, and two vibrant accent colors.

*   **Primary Background (Canvas):** Pure White (`#FFFFFF`)
    *   *Purpose:* Acts as a stark, clean canvas that allows the structural lines and vibrant accent colors to pop. It gives the design a crisp, magazine-like print quality.
*   **Structural & Typographic Base:** Ink Black (`#1A1A1A`)
    *   *Purpose:* Used for all text, borders, and inverted action elements (like primary buttons). It grounds the design and provides the high contrast necessary for the editorial aesthetic.
*   **Primary Accent:** Aqua (`#8BDFDD`)
    *   *Purpose:* Used for structural highlights, primary call-to-actions, and key data visualization components. It provides a cool, industrial contrast to the warmth of the yellow.
*   **Secondary Accent:** Yellow (`#FFE394`)
    *   *Purpose:* Used for secondary highlights, warning states, and softer visual breaks. It adds a layer of warmth and playfulness to the rigid grid.

## 2. Typography

The typographic scale is heavily influenced by traditional print media, blending utilitarian sans-serifs with elegant serifs.

*   **Sans-Serif (Utility & Body):** `Helvetica Neue`, Arial, sans-serif
    *   Used for primary navigation, body copy, and UI metadata. Small text is frequently set in uppercase with extremely wide letter-spacing (`tracking-widest`) to create a brutalist, technical feel (e.g., `text-[10px] uppercase tracking-widest font-bold`).
*   **Serif (Display & Emphasis):** `Georgia`, serif
    *   Used for large display headings and key metrics. It is almost exclusively used in an *italic* style (e.g., `font-serif italic`) to contrast sharply with the rigid, boxy UI containers, adding a layer of editorial elegance.
*   **Monospace (Technical Data):** System Monospace
    *   Used sparingly for timestamps, version numbers, and hex codes (e.g., `font-mono`). It reinforces the "research" and "technical" undertones of the design.

## 3. Layout & Styling Principles

The aesthetic is achieved through strict adherence to the following structural rules:

*   **Hard Borders (The Wireframe Look):** Every major component, button, and container is outlined with a solid 1px `#1A1A1A` border. This visible structure mimics the layout grids of early web design or print layout software.
*   **Zero Border Radius:** There are no rounded corners. Every box is perfectly rectangular, enforcing a rigid, masonry-like grid that looks sharp and deliberate.
*   **High Contrast Hover States:** Interactive elements (buttons, links) do not use subtle fading shadows. Instead, they rely on stark color inversions (e.g., Black to Aqua, or White to Yellow) and solid background color fills.
*   **Intentional Asymmetry & Spacing:** While governed by a grid, internal paddings are generous to allow content to breathe, similar to the margins of a high-end magazine or poster.
*   **Geometric Decor:** Decorative elements are reduced to primitive shapes—simple colored squares, raw structural lines extending past their containers, and visible grid frameworks.
