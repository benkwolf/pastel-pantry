import React, { useState, useEffect } from 'react';
import { ChefHat, Check, ShoppingCart, BookOpen, RefreshCw, ArrowRight, Save, Trash2, Book, X } from 'lucide-react';

const RecipeParserApp = () => {
  const [inputText, setInputText] = useState('');
  const [parsedRecipe, setParsedRecipe] = useState(null);
  const [checkedIngredients, setCheckedIngredients] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [scaleFactor, setScaleFactor] = useState(1); // Default scale is 1x
  const [showCookbook, setShowCookbook] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [notification, setNotification] = useState(null);
  const [savedRecipes, setSavedRecipes] = useState(() => {
    const saved = localStorage.getItem('pastelPantryRecipes');
    return saved ? JSON.parse(saved) : [];
  });


  useEffect(() => {
    localStorage.setItem('pastelPantryRecipes', JSON.stringify(savedRecipes));
  }, [savedRecipes]);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // Helper to parse number from string (fraction or decimal)
  const parseNumber = (str) => {
    try {
      if (str.includes('/')) {
        const [num, den] = str.split('/').map(Number);
        if (!isNaN(num) && !isNaN(den) && den !== 0) return num / den;
      }
      const num = parseFloat(str);
      if (!isNaN(num)) return num;
    } catch (e) {}
    return null;
  };

  // Derived state for scaled recipe
  const displayedRecipe = React.useMemo(() => {
    if (!parsedRecipe) return null;
    if (scaleFactor === 1) return parsedRecipe;

    const scaledIngredients = parsedRecipe.ingredients.map(ing => {
      if (ing.isHeader) return ing;
      
      const parts = ing.text.split(' ');
      if (parts.length > 0) {
        const quantity = parts[0];
        const val = parseNumber(quantity);
        
        if (val !== null) {
           const newVal = val * scaleFactor;
           // Format: Remove trailing zeros, max 2 decimals
           const scaledQuantity = Number(newVal.toFixed(2)).toString();
           return { ...ing, text: `${scaledQuantity} ${parts.slice(1).join(' ')}` };
        }
      }
      return ing;
    });

    return { ...parsedRecipe, ingredients: scaledIngredients };
  }, [parsedRecipe, scaleFactor]);

  // Simple heuristic parser to separate ingredients from instructions
  const parseRecipeText = (text) => {
    console.log("--- Starting Parser ---");
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    let ingredients = [];
    let instructions = [];
    let currentSection = null; // 'ingredients' | 'instructions' | null

    // Keywords to identify sections

    const ingredientKeywords = ['ingredient', 'shopping list', 'what you need'];
    const instructionKeywords = ['instruction', 'direction', 'method', 'preparation', 'how to make', 'steps'];
    const stopKeywords = ['notes', 'recipe notes', 'nutrition'];

    for (let line of lines) {
      // Clean up bullets/checkboxes/numbers from the start of the line
      // This handles: "• Flour", "☐ Sugar", "1. Mix", "- Butter"
      line = line.replace(/^[\s\u2022\u2023\u25E6\u2043\u2219\*\-\+\[\]\u2610\u2611\u2612\u25A0\u25A1\u25AA\u25ABo]+/, '').trim();
      const lowerLine = line.toLowerCase();
      
      // Stop parsing if we hit the footer sections (Notes, Nutrition, etc.)
      // Only stop if it looks like a header (short length), not a sentence starting with "Notes..."
      if (stopKeywords.some(keyword => lowerLine.startsWith(keyword)) && lowerLine.length < 60) {
        console.log(`Stopping at keyword: "${line}"`);
        currentSection = null;
        continue;
      }

      // Skip common UI elements found in copy-pastes (Jump links, toggles)
      // BUT, don't skip if it looks like an Ingredient header (e.g. "Ingredients US Customary")
      const isHeaderCandidate = ingredientKeywords.some(k => lowerLine.includes(k)) || instructionKeywords.some(k => lowerLine.includes(k));
      if (!isHeaderCandidate && (lowerLine.includes('jump to') || lowerLine.includes('print recipe') || lowerLine.includes('us customary'))) {
        console.log(`Skipping UI element: "${line}"`);
        continue;
      }

      // Check if line is a header
      const isIngredientHeader = ingredientKeywords.some(keyword => lowerLine.includes(keyword) && lowerLine.length < 100);
      const isInstructionHeader = instructionKeywords.some(keyword => lowerLine.includes(keyword) && lowerLine.length < 100);

      if (isIngredientHeader) {
        console.log(`Section detected (Ingredients): "${line}"`);
        currentSection = 'ingredients';
        continue;
      } else if (isInstructionHeader) {
        console.log(`Section detected (Instructions): "${line}"`);
        currentSection = 'instructions';
        continue;
      }

      // Add content to respective sections
      if (currentSection === 'ingredients') {
        // Basic filtering to avoid capturing UI text like "Add to cart"
        if (line.length < 200) {
            // Heuristic for sub-headers: Ends in colon, or starts with "For/To/Make" and is short, or is very short and has no numbers

            const isHeader = line.endsWith(':') || (line.length < 50 && /^(For |To |Make |Filling|Crust|Sauce|Frosting|Dressing|Marinade)/i.test(line));

            ingredients.push({ text: line, isHeader });
        }
      } else if (currentSection === 'instructions') {
        // Heuristic for sub-headers in instructions
        const isHeader = line.endsWith(':') || (line.length < 50 && /^(For |To |Make )/i.test(line));
        instructions.push({ text: line, isHeader });
      }
    }

    // Fallback: If parser fails to find headers, split roughly in half (naive approach)
    if (ingredients.length === 0 && instructions.length === 0 && lines.length > 0) {
        const midpoint = Math.floor(lines.length / 2);
        ingredients = lines.slice(0, midpoint).map(text => ({ text, isHeader: false }));
        instructions = lines.slice(midpoint).map(text => ({ text, isHeader: false }));
    }

    console.log(`Parsed: ${ingredients.length} ingredients, ${instructions.length} instructions.`);
    return { ingredients, instructions };
  };

  const handleParse = async () => {
    console.log(`Input received: ${inputText.substring(0, 50)}...`);
    const isUrl = inputText.trim().toLowerCase().startsWith('http');

    if (isUrl) {
      setIsLoading(true);
      let htmlText = '';

      // 1. Try Local Backend Server (Puppeteer) ONLY for Instagram (as requested for speed on others)
      if (inputText.includes('instagram.com/')) {
        try {
          // Try the Vercel Serverless Function (relative path /api/scrape)
          const res = await fetch(`/api/scrape?url=${encodeURIComponent(inputText)}`);
          if (res.ok) {
              const data = await res.json();
              htmlText = data.html;
              console.log("Fetched HTML via Vercel Serverless Function");
          }
        } catch (e) {
          console.log("Serverless function failed, falling back to public proxies...");
        }
      }

      try {
        // Instagram Handling
        if (!htmlText && inputText.includes('instagram.com/')) {
          console.log("Attempting to fetch Instagram data...");
          try {
            // Try OEmbed first (Official API, often works for public posts)
            const oembedUrl = `https://api.instagram.com/oembed/?url=${encodeURIComponent(inputText)}`;
            let data = null;

            // Try Primary Proxy
            try {
                const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(oembedUrl)}`);
                if (res.ok) {
                    data = await res.json();
                } else {
                    throw new Error('Primary proxy failed');
                }
            } catch (err) {
                console.log("Primary OEmbed failed, trying fallback 1...");
                try {
                    // Try Fallback Proxy 1 (NoEmbed) - Supports CORS natively
                    const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(inputText)}`);
                    const json = await res.json();
                    if (json.title) {
                        data = json;
                    } else {
                        throw new Error('No title in noembed');
                    }
                } catch (err2) {
                    console.log("Fallback 1 failed, trying fallback 2...");
                    try {
                        // Try Fallback Proxy 2 (CodeTabs) - Fetch HTML directly if API fails
                        const res = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(inputText)}`);
                        if (res.ok) {
                            htmlText = await res.text();
                            console.log("Fetched Instagram HTML via CodeTabs fallback");
                        }
                    } catch (err3) {
                        console.log("All OEmbed proxies failed");
                    }
                }
            }

            if (data && data.title) {
              console.log("Instagram OEmbed title found");
              setParsedRecipe(parseRecipeText(data.title));
              setIsLoading(false);
              return;
            }
          } catch (e) {
            console.log("Instagram OEmbed failed, falling back to HTML fetch", e);
          }
        }

        console.log("Attempting to fetch URL via proxy...");
        
        if (!htmlText && !inputText.includes('instagram.com/')) {          
          try {
          // Primary: corsproxy.io
          const response = await fetch(`https://corsproxy.io/?${encodeURIComponent(inputText)}`);
          const text = await response.text();
          if (text.includes('Response exceeds 1MB size limit')) throw new Error('Size limit exceeded');
          htmlText = text;
        } catch (err) {
          console.log("Primary proxy failed, trying fallback:", err);
           try {
            // Fallback: allorigins.win
            const response = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(inputText)}`);
            const data = await response.json();
            htmlText = data.contents;
          } catch (err2) {
            console.log("AllOrigins failed, trying CodeTabs...", err2);
            // Fallback: CodeTabs
            const response = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(inputText)}`);
            htmlText = await response.text();
          }
        }
        }

        console.log(`HTML content length: ${htmlText ? htmlText.length : 0}`);
        
        if (htmlText) {
          // Regex fallback for Instagram before DOM parsing (Robust against hidden DOM)
          if (inputText.includes('instagram.com/')) {
             // Look for shared data caption pattern in raw HTML
             const captionRegex = /"edge_media_to_caption":\{"edges":\[\{"node":\{"text":"((?:[^"\\]|\\.)*)"\}\}\]\}/;
             const match = htmlText.match(captionRegex);
             if (match && match[1]) {
                 try {
                     const caption = JSON.parse(`"${match[1]}"`);
                     console.log("Found Instagram caption via Regex");
                     setParsedRecipe(parseRecipeText(caption));
                     setIsLoading(false);
                     return;
                 } catch (e) { console.log("Regex caption parse failed", e); }
             }

             // Fallback Regex: Look for og:description meta tag directly in raw HTML
             // This is often more reliable than DOM parsing for Instagram
             const metaRegex = /<meta[^>]*property="og:description"[^>]*content="([^"]*)"/i;
             const metaMatch = htmlText.match(metaRegex);
             if (metaMatch && metaMatch[1]) {
                 // Decode HTML entities if necessary (basic check)
                 const decodedDesc = metaMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
                 console.log("Found Instagram caption via Regex (og:description)");
                 setParsedRecipe(parseRecipeText(decodedDesc));
                 setIsLoading(false);
                 return;
             }
          }

          // Check for Instagram Login Wall (Check this AFTER trying to extract data via regex)
          if (inputText.includes('instagram.com') && (htmlText.includes('Log in to Instagram') || htmlText.includes('Create an account'))) {
             console.log("Login wall detected");
             setNotification("Instagram blocked the request. Please paste the caption text manually.");
             setIsLoading(false);
             return;
          }

          // Parse the HTML string into a DOM object
          if (typeof DOMParser === 'undefined') {
             throw new Error('DOMParser is not available in this environment (Node.js). Please use JSDOM or run in a browser.');
          }
          const parser = new DOMParser();
          const doc = parser.parseFromString(htmlText, 'text/html');
          
          // Extract JSON-LD before removing scripts
          let jsonLdText = '';
          doc.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
            try {
                const json = JSON.parse(script.innerText);
                if (json.description) jsonLdText += json.description + '\n';
                if (json.articleBody) jsonLdText += json.articleBody + '\n';
            } catch (e) {}
          });

          // Remove scripts, styles, and other non-content elements
          doc.querySelectorAll('script, style, nav, footer, iframe, svg, noscript').forEach(el => el.remove());
          
          // Special handling for Instagram meta description
          if (inputText.includes('instagram.com/')) {
            const metaDesc = doc.querySelector('meta[property="og:description"]')?.content || 
                             doc.querySelector('meta[name="description"]')?.content;
            
            const combinedText = (metaDesc || '') + '\n' + jsonLdText;

            if (combinedText.trim().length > 0) {
              console.log("Found Instagram data via meta/json-ld");
              setParsedRecipe(parseRecipeText(combinedText));
              setIsLoading(false);
              return;
            }
          }
          
          // Try to find a specific recipe container to reduce noise (blog intro, sidebar, etc.)
          const recipeContainerSelectors = [
            '.wprm-recipe-container', 
            '.tasty-recipes', 
            '.mv-create-wrapper', 
            '.recipe-card',
            '[class*="recipe-container"]',
            '[class*="recipe-card"]'
          ];
          
          let contentNode = doc.body;
          const foundContainer = recipeContainerSelectors.find(selector => doc.querySelector(selector));
          if (foundContainer) {
             console.log(`Found recipe container: ${foundContainer}`);
             contentNode = doc.querySelector(foundContainer);
          }

          // Strategy 1: DOM Extraction (More accurate for supported sites)
          const extractStructuredContent = (strategies) => {
            for (const { selector, headerSelector } of strategies) {
              const elements = contentNode.querySelectorAll(selector);
              if (elements.length > 0) {
                return Array.from(elements).map(el => {
                  const text = el.innerText.replace(/\s+/g, ' ').trim();
                  const isHeader = headerSelector ? el.matches(headerSelector) : false;
                  return { text, isHeader };
                }).filter(item => item.text.length > 2 || (item.isHeader && item.text.length > 0));
              }
            }
            return [];
          };

          // Strategy 1.5: Heuristic DOM Extraction (Find lists after headers)
          // This handles the "checklist format" by finding the list (ul/ol) that follows a header
          const findListAfterHeader = (keywords) => {
            const headers = Array.from(contentNode.querySelectorAll('h1, h2, h3, h4, h5, h6, strong, b, div'));
            
            for (const h of headers) {
                const text = h.innerText.toLowerCase();
                if (keywords.some(k => text.includes(k)) && text.length < 100) {
                    // Look forward for a list
                    let sibling = h.nextElementSibling;
                    let attempts = 0;
                    while (sibling && attempts < 5) {
                        // Direct list
                        if (sibling.tagName === 'UL' || sibling.tagName === 'OL') {
                            return Array.from(sibling.querySelectorAll('li'))
                                .map(el => el.innerText.replace(/\s+/g, ' ').trim())
                                .filter(t => t.length > 2).map(text => ({ text, isHeader: false }));
                        }
                        // List wrapped in div
                        const internalList = sibling.querySelector('ul, ol');
                        if (internalList) {
                             return Array.from(internalList.querySelectorAll('li'))
                                .map(el => el.innerText.replace(/\s+/g, ' ').trim())
                                .filter(t => t.length > 2).map(text => ({ text, isHeader: false }));
                        }
                        sibling = sibling.nextElementSibling;
                        attempts++;
                    }
                }
            }
            return [];
          };

          const domIngredients = extractStructuredContent([
            { selector: '.wprm-recipe-ingredients-container .wprm-recipe-group-name, .wprm-recipe-ingredients-container .wprm-recipe-ingredient', headerSelector: '.wprm-recipe-group-name' },
            { selector: '.tasty-recipes-ingredients .tasty-recipes-group-name, .tasty-recipes-ingredients li', headerSelector: '.tasty-recipes-group-name' },
            { selector: '.mv-create-ingredients .mv-create-ingredients-header, .mv-create-ingredients li', headerSelector: '.mv-create-ingredients-header' },
            { selector: '.recipe-ingredients h3, .recipe-ingredients h4, .recipe-ingredients li', headerSelector: '.recipe-ingredients h3, .recipe-ingredients h4' },
            { selector: 'li[class*="ingredient"]', headerSelector: null }
          ]);
          
          // Fallback to header heuristic if class extraction failed
          const finalIngredients = domIngredients.length > 0 
            ? domIngredients 
            : findListAfterHeader(['ingredient', 'shopping list', 'what you need']);

          const domInstructions = extractStructuredContent([
            { selector: '.wprm-recipe-instructions-container .wprm-recipe-group-name, .wprm-recipe-instructions-container .wprm-recipe-instruction', headerSelector: '.wprm-recipe-group-name' },
            { selector: '.tasty-recipes-instructions .tasty-recipes-group-name, .tasty-recipes-instructions li', headerSelector: '.tasty-recipes-group-name' },
            { selector: '.mv-create-instructions .mv-create-instructions-header, .mv-create-instructions li', headerSelector: '.mv-create-instructions-header' },
            { selector: '.recipe-instructions h3, .recipe-instructions h4, .recipe-instructions li', headerSelector: '.recipe-instructions h3, .recipe-instructions h4' },
            { selector: 'li[class*="instruction"]', headerSelector: null }
          ]).map(item => ({ ...item, text: item.isHeader ? item.text : item.text.replace(/^\d+\.\s*/, '') }));

          // Fallback to header heuristic for instructions
          const finalInstructions = domInstructions.length > 0 
            ? domInstructions 
            : findListAfterHeader(['instruction', 'direction', 'method', 'preparation']).map(item => ({ ...item, text: item.text.replace(/^\d+\.\s*/, '') }));

          if (finalIngredients.length > 0 && finalInstructions.length > 0) {
            console.log(`DOM Extraction success: ${finalIngredients.length} ingredients, ${finalInstructions.length} instructions.`);
            setParsedRecipe({ ingredients: finalIngredients, instructions: finalInstructions });
          } else {
            // Strategy 2: Text Parsing (Fallback)
            console.log("DOM Extraction failed, falling back to text parsing.");
            
            // Helper to extract text from detached DOM where innerText might be empty
            const getReadableText = (element) => {
                if (!element) return "";
                // Try innerText first
                const t = element.innerText || "";
                if (t.length > 1500) return t;
                
                // Fallback: Manual extraction preserving line breaks
                const clone = element.cloneNode(true);
                ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'br', 'tr'].forEach(tag => {
                    clone.querySelectorAll(tag).forEach(el => el.after('\n'));
                });
                return clone.textContent;
            };

            let text = getReadableText(contentNode);
            if (text.length < 1500 && contentNode !== doc.body) {
                console.log("Container text too short, falling back to full document body.");
                text = getReadableText(doc.body);
            }
            
            console.log(`Extracted text length: ${text.length}`);
            setParsedRecipe(parseRecipeText(text));
          }
        }
      } catch (error) {
        console.error("Fetch error:", error);
        alert("Could not fetch this website. Try pasting the text manually.");
      }
      setIsLoading(false);
    } else {
      const result = parseRecipeText(inputText);
      setParsedRecipe(result);
    }
    setCheckedIngredients({});
  };

  const toggleIngredient = (index) => {
    setCheckedIngredients(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  const handleSave = () => {
    setSaveName("My Delicious Recipe");
    setShowSaveModal(true);
  };

  const confirmSave = () => {
    if (saveName.trim()) {
      const newRecipe = {
        id: Date.now(),
        name: saveName,
        date: new Date().toLocaleDateString(),
        data: parsedRecipe
      };
      setSavedRecipes([newRecipe, ...savedRecipes]);
      setShowSaveModal(false);
      setNotification("Recipe saved to My Cookbook!");
    }
  };

  const handleLoad = (recipe) => {
    setParsedRecipe(recipe.data);
    setScaleFactor(1);
    setShowCookbook(false);
    setCheckedIngredients({});
  };

  const handleDelete = (id, e) => {
    e.stopPropagation();
    if (window.confirm("Are you sure you want to delete this recipe?")) {
      setSavedRecipes(savedRecipes.filter(r => r.id !== id));
    }
  };

  const handleReset = () => {
    setInputText('');
    setParsedRecipe(null);
    setCheckedIngredients({});
  };

  return (
    <div className="min-h-screen bg-stone-50 font-sans text-stone-800 p-6 md:p-12">
      <div className="max-w-6xl mx-auto">
        
        {/* Header */}
        <header className="mb-10 text-center">
          <h1 className="text-4xl font-serif text-rose-400 flex items-center justify-center gap-3 mb-2">
            <ChefHat size={40} />
            Pastel Pantry
          </h1>
          <p className="text-stone-500 mb-6">Turn messy recipe websites into clean cookbooks.</p>
          
          <button 
            onClick={() => setShowCookbook(!showCookbook)}
            className={`inline-flex items-center gap-2 px-6 py-2 rounded-full font-bold transition-all ${showCookbook ? 'bg-stone-800 text-white' : 'bg-white text-stone-600 shadow-sm hover:bg-stone-100'}`}
          >
            <Book size={18} /> My Cookbook ({savedRecipes.length})
          </button>
        </header>

        {/* Notification Toast */}
        {notification && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-stone-800 text-white px-6 py-3 rounded-full shadow-lg z-50 transition-all">
            {notification}
          </div>
        )}

        {/* Save Modal */}
        {showSaveModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-serif font-bold text-stone-800">Save Recipe</h3>
                <button onClick={() => setShowSaveModal(false)} className="text-stone-400 hover:text-stone-600">
                  <X size={24} />
                </button>
              </div>
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                className="w-full p-3 rounded-xl bg-stone-50 border border-stone-200 mb-6 focus:ring-2 focus:ring-rose-200 outline-none"
                placeholder="Recipe Name"
                autoFocus
              />
              <div className="flex gap-3">
                <button onClick={() => setShowSaveModal(false)} className="flex-1 py-3 rounded-xl font-bold text-stone-500 hover:bg-stone-100 transition-colors">Cancel</button>
                <button onClick={confirmSave} className="flex-1 py-3 rounded-xl font-bold text-white bg-rose-400 hover:bg-rose-500 transition-colors">Save</button>
              </div>
            </div>
          </div>
        )}

        {showCookbook ? (
          /* Saved Recipes View */
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 animate-fade-in">
            {savedRecipes.length === 0 ? (
              <div className="col-span-full text-center py-20 text-stone-400 bg-white rounded-3xl border-4 border-dashed border-stone-200">
                <Book size={48} className="mx-auto mb-4 opacity-20" />
                <p>No saved recipes yet.</p>
                <button onClick={() => setShowCookbook(false)} className="text-rose-400 font-bold mt-2 hover:underline">Parse a new one!</button>
              </div>
            ) : (
              savedRecipes.map(recipe => (
                <div key={recipe.id} onClick={() => handleLoad(recipe)} className="bg-white p-6 rounded-2xl shadow-md hover:shadow-xl transition-all cursor-pointer border-2 border-transparent hover:border-rose-200 group relative">
                  <h3 className="font-serif text-xl text-stone-800 mb-2 pr-8">{recipe.name}</h3>
                  <p className="text-xs text-stone-400 font-bold uppercase tracking-wider mb-4">{recipe.date}</p>
                  <div className="flex gap-2 text-sm text-stone-500">
                    <span className="bg-emerald-50 text-emerald-600 px-2 py-1 rounded-md">{recipe.data.ingredients.length} Ingred.</span>
                    <span className="bg-violet-50 text-violet-600 px-2 py-1 rounded-md">{recipe.data.instructions.length} Steps</span>
                  </div>
                  <button 
                    onClick={(e) => handleDelete(recipe.id, e)}
                    className="absolute top-4 right-4 p-2 text-stone-300 hover:text-red-400 hover:bg-red-50 rounded-full transition-colors"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))
            )}
          </div>
        ) : !parsedRecipe ? (
          /* Input Section */
          <div className="bg-white rounded-3xl shadow-xl p-8 border-4 border-rose-100 max-w-3xl mx-auto transition-all hover:shadow-2xl">
            <label className="block text-lg font-medium text-stone-600 mb-4">
              Paste a recipe URL or text here:
            </label>
            <textarea
              className="w-full h-64 p-4 rounded-xl bg-stone-50 border border-stone-200 focus:ring-4 focus:ring-rose-100 focus:border-rose-300 outline-none transition-all resize-none text-sm"
              placeholder="Paste a link (e.g., https://...) or copy-paste the text manually..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
            />
            <button
              onClick={handleParse}
              disabled={!inputText.trim() || isLoading}
              className="mt-6 w-full bg-rose-300 hover:bg-rose-400 text-white font-bold py-4 px-6 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
            >
              {isLoading ? (
                <><RefreshCw className="animate-spin" size={20} /> Fetching Recipe...</>
              ) : (
                <>Clean up my Recipe <ArrowRight size={20} /></>
              )}
            </button>
          </div>
        ) : (
          /* Display Section */
          <div className="grid md:grid-cols-12 gap-8">
            
            {/* Left Column: Ingredients (Shopping List) */}
            <div className="md:col-span-4 space-y-6">
              <div className="bg-emerald-50 rounded-3xl p-6 shadow-lg border-2 border-emerald-100 sticky top-6">
                <div className="flex items-center justify-between mb-6 border-b-2 border-emerald-100 pb-4 gap-4">
                  <h2 className="text-2xl font-serif text-emerald-600 flex items-center gap-2">
                    <ShoppingCart size={24} />
                    Ingredients
                  </h2>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center bg-white rounded-lg px-2 py-1 border border-emerald-200">
                        <label htmlFor="scale" className="text-xs font-bold text-emerald-700 mr-2 uppercase">Scale:</label>
                        <input
                            type="number"
                            id="scale"
                            min="1"
                            step="1"
                            className="w-12 text-sm font-bold text-emerald-900 outline-none text-center"
                            value={scaleFactor}
                            onChange={(e) => setScaleFactor(parseFloat(e.target.value) || 1)}
                        />
                    </div>
                    <span className="text-xs font-bold bg-emerald-200 text-emerald-800 px-2 py-1 rounded-full">
                        {displayedRecipe.ingredients.length}
                    </span>
                  </div>
                </div>
                
                <ul className="space-y-3">
                  {displayedRecipe.ingredients.length > 0 ? (
                    displayedRecipe.ingredients.map((ing, idx) => (
                      ing.isHeader ? (
                        <h3 key={idx} className="font-bold text-emerald-700 mt-4 mb-2 uppercase text-xs tracking-wider">{ing.text.replace(/:$/, '')}</h3>
                      ) : (
                        <li 
                          key={idx} 
                          className={`flex items-start gap-3 p-2 rounded-lg transition-all cursor-pointer select-none ${checkedIngredients[idx] ? 'bg-emerald-100/50 opacity-50' : 'hover:bg-white'}`}
                          onClick={() => toggleIngredient(idx)}
                        >
                          <div className={`mt-1 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${checkedIngredients[idx] ? 'bg-emerald-400 border-emerald-400' : 'border-emerald-300 bg-white'}`}>
                            {checkedIngredients[idx] && <Check size={14} className="text-white" />}
                          </div>
                          <span className={`text-sm leading-relaxed ${checkedIngredients[idx] ? 'line-through text-emerald-700' : 'text-stone-700'}`}>
                            {ing.text}
                          </span>
                        </li>
                      )
                    ))
                  ) : (
                    <li className="text-stone-400 italic text-sm">No ingredients detected.</li>
                  )}
                </ul>
              </div>
              
              <button 
                onClick={handleReset}
                className="w-full md:hidden bg-stone-200 hover:bg-stone-300 text-stone-600 font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2"
              >
                <RefreshCw size={18} /> Start Over
              </button>
            </div>

            {/* Right Column: Instructions (Cookbook) */}
            <div className="md:col-span-8">
              <div className="bg-white rounded-3xl p-8 shadow-xl border-t-8 border-violet-200 min-h-[600px]">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-3xl font-serif text-violet-400 flex items-center gap-3">
                    <BookOpen size={32} />
                    Preparation
                  </h2>
                  <div className="flex gap-2">
                    <button 
                      onClick={handleSave}
                      className="hidden md:flex bg-rose-100 hover:bg-rose-200 text-rose-600 py-2 px-4 rounded-lg text-sm font-bold items-center gap-2 transition-colors"
                    >
                      <Save size={16} /> Save
                    </button>
                    <button 
                      onClick={handleReset}
                      className="hidden md:flex bg-stone-100 hover:bg-stone-200 text-stone-500 py-2 px-4 rounded-lg text-sm font-medium items-center gap-2 transition-colors"
                    >
                      <RefreshCw size={16} /> New
                    </button>
                  </div>
                </div>

                <div className="space-y-8">
                  {displayedRecipe.instructions.length > 0 ? (
                    (() => {
                      let stepCount = 0;
                      return displayedRecipe.instructions.map((step, idx) => {
                        if (!step.isHeader) stepCount++;
                        return step.isHeader ? (
                          <h3 key={idx} className="font-bold text-violet-600 mt-6 mb-3 text-xl font-serif">{step.text.replace(/:$/, '')}</h3>
                        ) : (
                          <div key={idx} className="group flex gap-6">
                            <div className="flex-shrink-0">
                              <span className="flex items-center justify-center w-10 h-10 rounded-full bg-violet-100 text-violet-500 font-serif font-bold text-lg group-hover:bg-violet-200 transition-colors">
                                {stepCount}
                              </span>
                            </div>
                            <div className="pt-1">
                              <p className="text-lg text-stone-700 leading-relaxed font-serif">
                                {step.text}
                              </p>
                            </div>
                          </div>
                        );
                      });
                    })()
                  ) : (
                    <div className="text-center py-20 text-stone-400">
                      <p>No instructions detected.</p>
                      <p className="text-sm mt-2">Try pasting the text again.</p>
                    </div>
                  )}
                </div>

                {/* Footer decoration */}
                <div className="mt-16 flex justify-center gap-2 opacity-30">
                    <div className="w-2 h-2 rounded-full bg-rose-300"></div>
                    <div className="w-2 h-2 rounded-full bg-emerald-300"></div>
                    <div className="w-2 h-2 rounded-full bg-violet-300"></div>
                </div>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
};

export default RecipeParserApp
