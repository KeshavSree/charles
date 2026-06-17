import numpy as np

from sklearn.feature_extraction.text import TfidfVectorizer

class TfidfScorer:
    def __init__(self):
        self.vectorizer = TfidfVectorizer()
        self.fitted = False
        self.feature_names = []

    def fit(self, corpus: list[str]):
        '''
        train with text from various job postings to distinguish between
        common phrases and unique keywords (used to rank importance of keywords)
        '''
        self.vectorizer.fit(corpus)
        self.fitted = True
        self.feature_names = self.vectorizer.get_feature_names_out()

    def score(self, text: str, keyword: str) -> float:
        if not self.fitted:
            raise RuntimeError('TfidfScorer must be fitted with a corpus before scoring.')
        
        keyword = keyword.lower().strip()
        matrix = self.vectorizer.transform([text])

        if keyword not in self.feature_names:
            return 0.0
        
        index = np.where(self.feature_names == keyword)[0][0]

        return float(matrix[0, index])