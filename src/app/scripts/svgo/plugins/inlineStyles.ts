/* tslint:disable */

import * as stable from 'stable';
import * as csso from 'csso';
import * as specificity from 'csso/lib/compressor/restructure/prepare/specificity';

export const inlineStyles = {
  active: true,
  type: 'full',
  fn: inlineStylesFn,
  params: {
    onlyMatchedOnce: false,
    removeMatchedSelectors: true,
    useMqs: ['screen'],
    usePseudoClasses: []
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
  *   useMqs (default: ['screen'])
  *     what mediaqueries to be used,
  *     non-mediaquery styles are always used
  *
  *   usePseudoClasses (default: [])
  *     what pseudo-classes to be used,
  *     non-pseudo-class styles are always used
  *
  * @param {Object} root (document)
  * @param {Object} params plugin params
  */
export function inlineStylesFn(document, params) {
  // collect <style/>s
  var styleEls = document.querySelectorAll('style');

  var styleItems = [],
    selectorItems = [];
  for (var styleElIndex in styleEls) {
    var styleEl = styleEls[styleElIndex];

    if (styleEl.isEmpty()) {
      // skip empty <style/>s
      continue;
    }
    var cssStr = styleEl.content[0].text || styleEl.content[0].cdata || [];

    // collect <style/>s and their css ast
    var cssAst = csso.parse(cssStr, { context: 'stylesheet' });
    styleItems.push({
      styleEl: styleEl,
      cssAst: cssAst
    });

    // collect css selectors and their containing ruleset
    var curAtruleExpNode = null,
      curPseudoClassItem = null,
      curPseudoClassList = null;
    csso.walk(cssAst, function (node, item, list) {

      // media query blocks
      // "look-behind the SimpleSelector", AtruleExpression node comes _before_ the affected SimpleSelector
      if (node.type === 'AtruleExpression') { // marks the beginning of an Atrule
        curAtruleExpNode = node;
      }
      // "look-ahead the SimpleSelector", Atrule node comes _after_ the affected SimpleSelector
      if (node.type === 'Atrule') { // marks the end of an Atrule
        curAtruleExpNode = null;
      }

      // Pseudo classes
      // "look-behind the SimpleSelector", PseudoClass node comes _before_ the affected SimpleSelector
      if (node.type === 'PseudoClass') {
        curPseudoClassItem = item;
        curPseudoClassList = list;
      }

      if (node.type === 'SimpleSelector') {
        // csso 'SimpleSelector' to be interpreted with CSS2.1 specs, _not_ with CSS3 Selector module specs:
        // Selector group ('Selector' in csso) consisting of simple selectors ('SimpleSelector' in csso), separated by comma.
        // <Selector>: <'SimpleSelector'>, <'SimpleSelector'>, ...

        var curSelectorItem = {
          simpleSelectorItem: item,
          rulesetNode: this.ruleset,
          atRuleExpNode: curAtruleExpNode,

          pseudoClassItem: curPseudoClassItem,
          pseudoClassList: curPseudoClassList
        };
        selectorItems.push(curSelectorItem);

        // pseudo class scope ends with the SimpleSelector
        curPseudoClassItem = null;
        curPseudoClassList = null;
      }
    });
  }


  // filter for mediaqueries to be used or without any mediaquery
  var selectorItemsMqs = selectorItems.filter(function (selectorItem) {
    if (selectorItem.atRuleExpNode === null) {
      return true;
    }
    var mqStr = csso.translate(selectorItem.atRuleExpNode);
    return params.useMqs.indexOf(mqStr) > -1;
  });

  // filter for pseudo classes to be used or not using a pseudo class
  var selectorItemsPseudoClasses = selectorItemsMqs.filter(function (selectorItem) {
    return (selectorItem.pseudoClassItem === null ||
      params.usePseudoClasses.indexOf(selectorItem.pseudoClassItem.data.name) > -1);
  });

  // remove PseudoClass from its SimpleSelector for proper matching
  selectorItemsPseudoClasses.map(function (selectorItem) {
    if (selectorItem.pseudoClassItem === null) {
      return;
    }
    selectorItem.pseudoClassList.remove(selectorItem.pseudoClassItem);
  });

  // stable-sort css selectors by their specificity
  var selectorItemsSorted = stable(selectorItemsPseudoClasses, function (itemA, itemB) {
    return compareSimpleSelectorNode(itemA.simpleSelectorItem.data, itemB.simpleSelectorItem.data);
  }).reverse(); // last declaration applies last (final)

  // apply <style/> styles to matched elements
  for (var selectorItemIndex in selectorItemsSorted) {
    var selectorItem = selectorItemsSorted[selectorItemIndex],
      selectorStr = csso.translate(selectorItem.simpleSelectorItem.data),
      selectedEls = null;
    try {
      selectedEls = document.querySelectorAll(selectorStr);
    } catch (e) {
      if (e.constructor == SyntaxError) {
        console.warn('Syntax error when trying to select \n\n' + selectorStr + '\n\n, skipped.');
        continue;
      }
      throw e;
    }

    if (params.onlyMatchedOnce && selectedEls !== null && selectedEls.length > 1) {
      // skip selectors that match more than once if option onlyMatchedOnce is enabled
      continue;
    }

    for (var selectedElIndex in selectedEls) {
      var selectedEl = selectedEls[selectedElIndex];

      // empty defaults in case there is no style attribute
      var elInlineStyleAttr = { name: 'style', value: '', prefix: '', local: 'style' },
        elInlineStyles = '';

      if (selectedEl.hasAttr('style')) {
        elInlineStyleAttr = selectedEl.attr('style');
        elInlineStyles = elInlineStyleAttr.value;
      }
      var inlineCssAst = csso.parse(elInlineStyles, { context: 'block' });

      // merge element(inline) styles + matching <style/> styles
      var newInlineCssAst = csso.parse('', { context: 'block' }); // for an empty css ast (in block context)

      var mergedDeclarations = [];
      var _fetchDeclarations = function (node, item) {
        if (node.type === 'Declaration') {
          mergedDeclarations.push(item);
        }
      };
      var itemRulesetNodeCloned = csso.clone(selectorItem.rulesetNode);
      // clone to prevent leaking declaration references (csso.translate(...))
      csso.walk(itemRulesetNodeCloned, _fetchDeclarations);
      csso.walk(inlineCssAst, _fetchDeclarations);

      // sort by !important(ce)
      var mergedDeclarationsSorted = stable(mergedDeclarations, function (declarationA, declarationB) {
        var declarationAScore = ~~declarationA.data.value.important, // (cast boolean to number)
          declarationBScore = ~~declarationB.data.value.important; //  "
        return (declarationAScore - declarationBScore);
      });

      // to css
      for (var mergedDeclarationsSortedIndex in mergedDeclarationsSorted) {
        var declaration = mergedDeclarationsSorted[mergedDeclarationsSortedIndex];
        newInlineCssAst.declarations.insert(declaration);
      }
      var newCss = csso.translate(newInlineCssAst);

      elInlineStyleAttr.value = newCss;
      selectedEl.addAttr(elInlineStyleAttr);
    }

    if (params.removeMatchedSelectors && selectedEls !== null && selectedEls.length > 0) {
      // clean up matching simple selectors if option removeMatchedSelectors is enabled
      selectorItem.rulesetNode.selector.selectors.remove(selectorItem.simpleSelectorItem);
    }
  }

  var styleItem: any = {};
  for (let styleItemIndex in styleItems) {
    styleItem = styleItems[styleItemIndex];

    csso.walk(styleItem.cssAst, function (node, item, list) {
      // clean up <style/> atrules without any rulesets left
      if (node.type === 'Atrule' &&
        // only Atrules containing rulesets
        node.block !== null &&
        typeof node.block.rules !== 'undefined' &&
        node.block.rules.isEmpty()) {
        list.remove(item);
      }

      // clean up <style/> rulesets without any css selectors left
      if (node.type === 'Ruleset' &&
        node.selector.selectors.isEmpty()) {
        list.remove(item);
      }
    });

    if (styleItem.cssAst.rules.isEmpty()) {
      // clean up now emtpy <style/>s
      var styleParentEl = styleItem.styleEl.parentNode;
      styleParentEl.spliceContent(styleParentEl.content.indexOf(styleItem.styleEl), 1);

      if (styleParentEl.elem === 'defs' &&
        styleParentEl.content.length === 0) {
        // also clean up now empty <def/>s
        var defsParentEl = styleParentEl.parentNode;
        defsParentEl.spliceContent(defsParentEl.content.indexOf(styleParentEl), 1);
      }

      continue;
    }

    // update existing, left over <style>s
    styleItem.styleEl.content[0].text = csso.translate(styleItem.cssAst);
  }

  return document;
};

// extracted from https://github.com/keeganstreet/specificity/blob/master/specificity.js#L211
function compareSpecificity(aSpecificity, bSpecificity) {
  for (var i = 0; i < 4; i += 1) {
    if (aSpecificity[i] < bSpecificity[i]) {
      return -1;
    } else if (aSpecificity[i] > bSpecificity[i]) {
      return 1;
    }
  }

  return 0;
}

function compareSimpleSelectorNode(aSimpleSelectorNode, bSimpleSelectorNode) {
  var aSpecificity = specificity(aSimpleSelectorNode),
    bSpecificity = specificity(bSimpleSelectorNode);
  return compareSpecificity(aSpecificity, bSpecificity);
}
