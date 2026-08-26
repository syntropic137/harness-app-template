import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';

export function getMDXComponents(components: MDXComponents): MDXComponents {
  return {
    // fumadocs-ui declares its `img` override as `sizes?: string`, while
    // React's ImgHTMLAttributes has `sizes?: string | undefined`. Under this
    // app's `exactOptionalPropertyTypes: true` those are different types, so
    // the spread fails to typecheck even though the components are compatible
    // at runtime. Narrow the assertion to the spread rather than loosening
    // the compiler flag for the whole app.
    ...(defaultMdxComponents as MDXComponents),
    ...components,
  };
}

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return getMDXComponents(components);
}
