/* tslint:disable */

import * as cssTools from 'app/scripts/svgo/lib/css-tools';
import * as csstree from 'css-tree';

export const inlineStyles = {
  active: true,
  type: 'full',
  fn: inlineStylesFn,
  params: {
    onlyMatchedOnce: false,
    removeMatchedSelectors: true,
    useMqs: ['', 'screen'],
    usePseudos: [''],
  },
};

/**
 * Moves + merges styles from style elements to element styles
 *
 * Options
 *   onlyMatchedOnce (default: true)
 *     inline only selectors that match once
 *
 *   removeMatchedSelectors (default: true)
 *     clean up matched selectors,
 *     leave selectors that hadn't matched
 *
 *   useMqs (default: ['', 'screen'])
 *     what media queries to be used
 *     empty string element for styles outside media queries
 *
 *   usePseudos (default: [''])
 *     what pseudo-classes/-elements to be used
 *     empty string element for all non-pseudo-classes and/or -elements
 *
 * @param {Object} document document element
 * @param {Object} opts plugin params
 *
 * @author strarsis <strarsis@gmail.com>
 */
function inlineStylesFn(document, opts) {
  // collect <style/>s
  var styleEls = document.querySelectorAll('style');

  //no <styles/>s, nothing to do
  if (styleEls === null) {
    return document;
  }

  var styles = [],
    selectors = [];

  for (var styleEl of styleEls) {
    if (styleEl.isEmpty()) {
      // skip empty <style/>s
      continue;
    }
    var cssStr = cssTools.getCssStr(styleEl);

    // collect <style/>s and their css ast
    var cssAst = {};
    try {
      cssAst = csstree.parse(cssStr, {
        parseValue: false,
        parseCustomProperty: false,
      });
    } catch (parseError) {
      console.warn(
        'Warning: Parse error of styles of <style/> element, skipped. Error details: ' + parseError,
      );
      continue;
    }

    styles.push({
      styleEl: styleEl,
      cssAst: cssAst,
    });

    selectors = selectors.concat(cssTools.flattenToSelectors(cssAst));
  }

  // filter for mediaqueries to be used or without any mediaquery
  var selectorsMq = cssTools.filterByMqs(selectors, opts.useMqs);

  // filter for pseudo elements to be used
  var selectorsPseudo = cssTools.filterByPseudos(selectorsMq, opts.usePseudos);

  // remove PseudoClass from its SimpleSelector for proper matching
  cssTools.cleanPseudos(selectorsPseudo);

  // stable sort selectors
  var sortedSelectors = cssTools.sortSelectors(selectorsPseudo).reverse();

  // apply <style/> styles to matched elements
  for (var selector of sortedSelectors) {
    var selectorStr = csstree.translate(selector.item.data),
      selectedEls = null;

    try {
      selectedEls = document.querySelectorAll(selectorStr);
    } catch (selectError) {
      if (selectError.constructor === SyntaxError) {
        console.warn(
          'Warning: Syntax error when trying to select \n\n' +
            selectorStr +
            '\n\n, skipped. Error details: ' +
            selectError,
        );
        continue;
      }
      throw selectError;
    }

    if (selectedEls === null) {
      // nothing selected
      continue;
    }

    if (opts.onlyMatchedOnce && selectedEls !== null && selectedEls.length > 1) {
      // skip selectors that match more than once if option onlyMatchedOnce is enabled
      continue;
    }

    // apply <style/> to matched elements
    for (var selectedEl of selectedEls) {
      if (selector.rule === null) {
        continue;
      }

      // merge declarations
      csstree.walkDeclarations(selector.rule, function(styleCsstreeDeclaration) {
        var styleDeclaration = cssTools.csstreeToStyleDeclaration(styleCsstreeDeclaration);
        if (
          selectedEl.style.getPropertyValue(styleDeclaration.name) !== null &&
          selectedEl.style.getPropertyPriority(styleDeclaration.name) >= styleDeclaration.priority
        ) {
          return;
        }
        selectedEl.style.setProperty(
          styleDeclaration.name,
          styleDeclaration.value,
          styleDeclaration.priority,
        );
      });
    }

    if (opts.removeMatchedSelectors && selectedEls !== null && selectedEls.length > 0) {
      // clean up matching simple selectors if option removeMatchedSelectors is enabled
      selector.rule.selector.children.remove(selector.item);
    }
  }

  for (var style of styles) {
    csstree.walkRules(style.cssAst, function(node, item, list) {
      // clean up <style/> atrules without any rulesets left
      if (
        node.type === 'Atrule' &&
        // only Atrules containing rulesets
        node.block !== null &&
        node.block.children.isEmpty()
      ) {
        list.remove(item);
        return;
      }

      // clean up <style/> rulesets without any css selectors left
      if (node.type === 'Rule' && node.selector.children.isEmpty()) {
        list.remove(item);
      }
    });

    if (style.cssAst.children.isEmpty()) {
      // clean up now emtpy <style/>s
      var styleParentEl = style.styleEl.parentNode;
      styleParentEl.spliceContent(styleParentEl.content.indexOf(style.styleEl), 1);

      if (styleParentEl.elem === 'defs' && styleParentEl.content.length === 0) {
        // also clean up now empty <def/>s
        var defsParentEl = styleParentEl.parentNode;
        defsParentEl.spliceContent(defsParentEl.content.indexOf(styleParentEl), 1);
      }

      continue;
    }

    // update existing, left over <style>s
    cssTools.setCssStr(style.styleEl, csstree.translate(style.cssAst));
  }

  return document;
}
