/**
 * CivicSync Custom Text Similarity Engine
 * 
 * A custom-built TF-IDF + Cosine Similarity model for civic issue text analysis.
 * Includes domain-specific synonym expansion for better matching of civic reports.
 */

class TextSimilarityEngine {
  constructor() {
    this.stopWords = new Set([
      'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
      'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
      'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
      'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
      'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
      'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
      'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'and',
      'but', 'or', 'nor', 'if', 'while', 'because', 'until', 'that', 'which',
      'who', 'whom', 'this', 'these', 'those', 'i', 'me', 'my', 'myself',
      'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 'he', 'him',
      'his', 'she', 'her', 'hers', 'it', 'its', 'they', 'them', 'their',
      'what', 'am', 'just', 'also', 'about', 'up', 'please', 'near', 'area'
    ]);

    // Civic issue domain-specific synonym groups
    this.synonymGroups = [
      ['pothole', 'pit', 'hole', 'crater', 'ditch', 'cavity'],
      ['road', 'street', 'highway', 'lane', 'path', 'pavement', 'footpath', 'sidewalk'],
      ['water', 'leak', 'leaking', 'flooding', 'flood', 'waterlogging', 'waterlogged'],
      ['drain', 'drainage', 'sewage', 'sewer', 'gutter', 'nala', 'nalla'],
      ['pipe', 'pipeline', 'plumbing', 'tap', 'valve'],
      ['garbage', 'trash', 'waste', 'dump', 'litter', 'rubbish', 'debris', 'filth'],
      ['light', 'lamp', 'streetlight', 'bulb', 'lighting', 'illumination'],
      ['broken', 'damaged', 'cracked', 'destroyed', 'deteriorated', 'collapsed', 'fallen'],
      ['tree', 'branch', 'uprooted', 'fallen tree', 'overgrown'],
      ['traffic', 'signal', 'sign', 'congestion', 'jam'],
      ['noise', 'pollution', 'loud', 'disturbance', 'nuisance'],
      ['park', 'garden', 'playground', 'green space', 'public space'],
      ['building', 'structure', 'construction', 'wall', 'boundary'],
      ['electricity', 'power', 'outage', 'blackout', 'wire', 'cable', 'transformer'],
      ['mosquito', 'insect', 'pest', 'breeding', 'stagnant'],
      ['encroachment', 'illegal', 'unauthorized', 'occupation'],
      ['animal', 'stray', 'dog', 'cattle', 'cow', 'menace'],
      ['danger', 'dangerous', 'hazard', 'hazardous', 'risk', 'unsafe', 'accident']
    ];

    // Build synonym lookup map: word -> group index
    this.synonymMap = new Map();
    this.synonymGroups.forEach((group, idx) => {
      group.forEach(word => this.synonymMap.set(word, idx));
    });
  }

  /**
   * Tokenize text: lowercase, remove punctuation, filter stop words
   */
  tokenize(text) {
    if (!text) return [];
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 1 && !this.stopWords.has(word));
  }

  /**
   * Simple suffix-stripping stemmer
   */
  stem(word) {
    if (word.length <= 3) return word;
    const suffixes = ['ation', 'tion', 'sion', 'ness', 'ment', 'able', 'ible', 'ful', 'less', 'ous', 'ive', 'ing', 'ed', 'er', 'ly', 'es', 's'];
    for (const suffix of suffixes) {
      if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
        return word.slice(0, -suffix.length);
      }
    }
    return word;
  }

  /**
   * Expand token list with domain-specific synonyms
   */
  expandWithSynonyms(tokens) {
    const expanded = new Set(tokens);
    tokens.forEach(token => {
      const groupIdx = this.synonymMap.get(token);
      if (groupIdx !== undefined) {
        this.synonymGroups[groupIdx].forEach(synonym => {
          // Only add single-word synonyms
          if (!synonym.includes(' ')) expanded.add(synonym);
        });
      }
    });
    return [...expanded];
  }

  /**
   * Compute term frequency for a tokenized document
   */
  computeTF(tokens) {
    const tf = new Map();
    const stemmedTokens = tokens.map(t => this.stem(t));
    stemmedTokens.forEach(token => {
      tf.set(token, (tf.get(token) || 0) + 1);
    });
    // Normalize by document length
    const docLength = stemmedTokens.length || 1;
    tf.forEach((count, term) => {
      tf.set(term, count / docLength);
    });
    return tf;
  }

  /**
   * Compute IDF (Inverse Document Frequency) from a corpus
   */
  computeIDF(tokenizedDocs) {
    const idf = new Map();
    const totalDocs = tokenizedDocs.length;

    // Document frequency: how many docs contain each term
    const df = new Map();
    tokenizedDocs.forEach(doc => {
      const uniqueTerms = new Set(doc.map(t => this.stem(t)));
      uniqueTerms.forEach(term => {
        df.set(term, (df.get(term) || 0) + 1);
      });
    });

    // IDF = log(N / df(t)) + 1 (smoothed to avoid zero)
    df.forEach((count, term) => {
      idf.set(term, Math.log(totalDocs / count) + 1);
    });

    return idf;
  }

  /**
   * Compute TF-IDF vector from TF and IDF maps
   */
  computeTFIDF(tf, idf) {
    const tfidf = new Map();
    tf.forEach((tfValue, term) => {
      const idfValue = idf.get(term) || 1;
      tfidf.set(term, tfValue * idfValue);
    });
    return tfidf;
  }

  /**
   * Cosine similarity between two TF-IDF vectors
   * Returns a value between 0 (no similarity) and 1 (identical)
   */
  cosineSimilarity(vec1, vec2) {
    const allTerms = new Set([...vec1.keys(), ...vec2.keys()]);

    let dotProduct = 0;
    let magnitude1 = 0;
    let magnitude2 = 0;

    allTerms.forEach(term => {
      const v1 = vec1.get(term) || 0;
      const v2 = vec2.get(term) || 0;
      dotProduct += v1 * v2;
      magnitude1 += v1 * v1;
      magnitude2 += v2 * v2;
    });

    magnitude1 = Math.sqrt(magnitude1);
    magnitude2 = Math.sqrt(magnitude2);

    if (magnitude1 === 0 || magnitude2 === 0) return 0;
    return dotProduct / (magnitude1 * magnitude2);
  }

  /**
   * Compute text similarity between a query and a corpus of documents
   * Returns array of similarity scores (0-1) for each document
   */
  computeSimilarities(queryText, corpusTexts) {
    const queryTokens = this.expandWithSynonyms(this.tokenize(queryText));
    const corpusTokenized = corpusTexts.map(text =>
      this.expandWithSynonyms(this.tokenize(text))
    );

    // Build IDF from all documents (corpus + query)
    const allDocs = [queryTokens, ...corpusTokenized];
    const idf = this.computeIDF(allDocs);

    // Compute TF-IDF for the query
    const queryTF = this.computeTF(queryTokens);
    const queryTFIDF = this.computeTFIDF(queryTF, idf);

    // Compute similarity of each corpus document against the query
    return corpusTokenized.map(docTokens => {
      const docTF = this.computeTF(docTokens);
      const docTFIDF = this.computeTFIDF(docTF, idf);
      return this.cosineSimilarity(queryTFIDF, docTFIDF);
    });
  }

  /**
   * Quick Jaccard similarity between two texts
   */
  jaccardSimilarity(text1, text2) {
    const set1 = new Set(this.tokenize(text1).map(t => this.stem(t)));
    const set2 = new Set(this.tokenize(text2).map(t => this.stem(t)));

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    if (union.size === 0) return 0;
    return intersection.size / union.size;
  }

  /**
   * Extract key terms (top N by TF-IDF score) from text
   */
  extractKeyTerms(text, topN = 5) {
    const tokens = this.tokenize(text);
    const tf = this.computeTF(tokens);

    // Sort by TF score (in a single-document context, TF alone is meaningful)
    const sorted = [...tf.entries()].sort((a, b) => b[1] - a[1]);
    return sorted.slice(0, topN).map(([term, score]) => ({ term, score: parseFloat(score.toFixed(4)) }));
  }
}

module.exports = TextSimilarityEngine;
