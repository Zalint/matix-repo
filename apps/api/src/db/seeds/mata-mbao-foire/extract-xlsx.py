# -*- coding: utf-8 -*-
"""
Extrait les données des fichiers Excel PROD de Mata vers du JSON exploitable
par le script TypeScript de seed.

Entrées :
  - Stock_Inventaire_02_04_2026.xlsx (3 feuilles : Stock Matin, Stock Soir, Transferts)
  - Tableau_Ventes_*_O.Foire.xlsx (1 feuille : Tableau des Ventes)

Sortie : stock-matin.json, stock-soir.json, transferts.json, ventes-ofoire.json
dans le même dossier que ce script.

Pourquoi en Python : la lib xlsx côté Node n'est pas installée, et pandas/openpyxl
sont déjà disponibles pour ce poste. Le JSON intermédiaire est ensuite consommé
par seed.ts qui fait les INSERT via le pool admin.
"""
import sys, io, json
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import pandas as pd

HERE = Path(__file__).parent
STOCK = r"C:\Users\douco\Downloads\Stock_Inventaire_02_04_2026.xlsx"
VENTES = r"C:\Users\douco\Downloads\Tableau_Ventes_20260511_02-04-2026_02-04-2026_O.Foire.xlsx"


def clean_str(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    return str(v).strip()


def clean_num(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    return float(v)


def to_list(df, mapping):
    """mapping : {colonne_csv: clé_json}, retourne une liste de dict"""
    out = []
    for _, row in df.iterrows():
        d = {}
        for src, dst in mapping.items():
            val = row[src]
            if isinstance(val, str):
                d[dst] = clean_str(val)
            elif isinstance(val, (int, float)):
                d[dst] = clean_num(val)
            else:
                d[dst] = clean_str(val) if val is not None else None
        # Skip totalement vide
        if any(v is not None for v in d.values()):
            out.append(d)
    return out


# ============================================================================
# STOCK MATIN / SOIR
# ============================================================================
qty_col = 'Quantit\xe9'  # 'Quantité'
matin = pd.read_excel(STOCK, sheet_name='Stock Matin')
soir = pd.read_excel(STOCK, sheet_name='Stock Soir')
transferts = pd.read_excel(STOCK, sheet_name='Transferts')

STOCK_MAP = {
    'Point de Vente': 'pos',
    'Produit': 'product',
    qty_col: 'quantity',
    'Prix Unitaire': 'unit_price',
}

stock_matin_json = to_list(matin, STOCK_MAP)
stock_soir_json = to_list(soir, STOCK_MAP)

TRANSFERTS_MAP = {
    'Point de Vente': 'pos',
    'Produit': 'product',
    'Impact (+/-)': 'impact',  # '+' ou '-'
    qty_col: 'quantity',
    'Prix Unitaire': 'unit_price',
}
transferts_json = to_list(transferts, TRANSFERTS_MAP)


# ============================================================================
# VENTES O.FOIRE
# ============================================================================
ventes = pd.read_excel(VENTES, sheet_name='Tableau des Ventes')
cat_col = 'Cat\xe9gorie'  # 'Catégorie'

VENTES_MAP = {
    'Heure': 'time',
    cat_col: 'category',
    'Produit': 'product',
    'Prix Unitaire': 'unit_price',
    qty_col: 'quantity',
    'Montant': 'amount',
    'Commande ID': 'order_id',
    'Point de Vente': 'pos',
    'Type de vente': 'sale_type',
}
ventes_json = to_list(ventes, VENTES_MAP)


# ============================================================================
# WRITE
# ============================================================================
files = {
    'stock-matin.json': stock_matin_json,
    'stock-soir.json': stock_soir_json,
    'transferts.json': transferts_json,
    'ventes-ofoire.json': ventes_json,
}
for name, data in files.items():
    out = HERE / name
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"  -> {name} ({len(data)} lignes)")

# Stats récap
print(f"\nStock matin : {len(stock_matin_json)} lignes")
print(f"Stock soir  : {len(stock_soir_json)} lignes")
print(f"Transferts  : {len(transferts_json)} lignes")
print(f"Ventes      : {len(ventes_json)} lignes")
