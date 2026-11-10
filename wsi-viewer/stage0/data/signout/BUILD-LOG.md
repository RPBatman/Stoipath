# data/signout · build log (content, Wave S1)

What built the 50 pilot slide indexes and thumbnails (SIGNOUT.md §7.3 steps 1–2, CNT-6), with the bytes each builder
read. Both builders are Wave S0's (source), run unchanged by `tools/build_signout_catalogue.py --build-slides`; every
byte read is cached under `<scratch>/signout/cache/ranges` (single closed Range requests only; never a multi-range or
an open-ended range). Nothing here is a slide or a tile: the slides stay in the bucket.

## Commands

```
python3 -I tools/build_signout_catalogue.py --build-slides --cache <scratch>/signout/cache --pylib <scratch>/pylib \
    --stage <scratch>/signout/content/stage
  # per slide: python3 -I tools/build_signout_index.py --no-pixels --slide <slide> --name <neutral id> --out <stage> \
  #                --cache <cache>/ranges --checksums <cache>/checksums.md5
  # then once: python3 -I tools/build_signout_pixels.py --pylib <pylib> --cache <cache>/ranges --index <stage>/<id>.index.json ×50
python3 -I tools/build_signout_overlays.py --xml-dir <scratch>/signout/cache/annotations
python3 -I tools/build_signout_catalogue.py
python3 -I tools/build_signout_cases.py
```

## Budget

- **Pixel builder (`build_signout_pixels.py`, the §7.3 step 2 budget):** total read 26949451 B (fetched 25446982 B) for 50 slides; budget 600000 B per slide, 40000000 B in all.
  Per slide 90,382–1,576,975 B (mean 538,989 B) over 50 slides; 13 slide(s) over 0.6 MB; total 26,949,451 B against the 40 MB limit: **within the 40 MB total; per-slide overage reported**.
- **Index builder (`build_signout_index.py --no-pixels`):** read 34,057,372 B; 36,088,377 B were fetched from the
  bucket (small reads are aligned to 16 KB blocks, so fetched can exceed read; what the facts probes had cached was not
  fetched again). It reads the IFD chain and every level's `TileByteCounts` array
  (8 B per tile) for the blank-tile candidates; the arrays of inline levels (≤ 320 tiles) are read whole. The §7.3
  budget is the pixel builder's; this line records the index builder's reads beside it.
- **Bucket egress for the whole build:** 36,088,377 B (index builder) + 25,446,982 B (pixel builder) = 61,535,359 B fetched
  once, in single closed ranges, and kept in the cache; no slide was downloaded (the 50 objects total about 144 GB).
- **Per-slide overage (SRC-N10, accepted by the integrator as A-SRC-N10):** the 13 slides marked OVER below read more
  than 0.6 MB because their pinned levels (longest side ≤ 2048 px) are dense: nine centre-2 slides (patient_046 nodes 0–4,
  patient_052 nodes 0–3; up to 1.58 MB) and four centre-1 slides (patient_025_node_0, patient_036 nodes 1–3; ≤ 0.67 MB). The builder reports them and enforces the 40 MB total.

## Index builder, per slide

- patient_004_node_0 (camelyon17.c17s-0001): 9 levels, read 827789 B, fetched 919736 B in 9 single closed ranges
- patient_004_node_1 (camelyon17.c17s-0002): 9 levels, read 789533 B, fetched 833096 B in 7 single closed ranges
- patient_004_node_2 (camelyon17.c17s-0003): 9 levels, read 827789 B, fetched 936120 B in 9 single closed ranges
- patient_004_node_3 (camelyon17.c17s-0004): 9 levels, read 827789 B, fetched 903352 B in 8 single closed ranges
- patient_004_node_4 (camelyon17.c17s-0005): 9 levels, read 789533 B, fetched 0 B in 0 single closed ranges
- patient_017_node_0 (camelyon17.c17s-0006): 9 levels, read 827789 B, fetched 952504 B in 10 single closed ranges
- patient_017_node_1 (camelyon17.c17s-0007): 9 levels, read 789533 B, fetched 865864 B in 8 single closed ranges
- patient_017_node_2 (camelyon17.c17s-0008): 9 levels, read 827789 B, fetched 886968 B in 7 single closed ranges
- patient_017_node_3 (camelyon17.c17s-0009): 9 levels, read 827789 B, fetched 952504 B in 10 single closed ranges
- patient_017_node_4 (camelyon17.c17s-0010): 9 levels, read 789533 B, fetched 849673 B in 8 single closed ranges
- patient_025_node_0 (camelyon17.c17s-0011): 9 levels, read 827789 B, fetched 952504 B in 10 single closed ranges
- patient_025_node_1 (camelyon17.c17s-0012): 9 levels, read 827789 B, fetched 952504 B in 10 single closed ranges
- patient_025_node_2 (camelyon17.c17s-0013): 9 levels, read 827789 B, fetched 952504 B in 10 single closed ranges
- patient_025_node_3 (camelyon17.c17s-0014): 9 levels, read 827789 B, fetched 952504 B in 10 single closed ranges
- patient_025_node_4 (camelyon17.c17s-0015): 9 levels, read 827789 B, fetched 903352 B in 8 single closed ranges
- patient_036_node_0 (camelyon17.c17s-0016): 9 levels, read 827789 B, fetched 903352 B in 8 single closed ranges
- patient_036_node_1 (camelyon17.c17s-0017): 9 levels, read 827789 B, fetched 952504 B in 10 single closed ranges
- patient_036_node_2 (camelyon17.c17s-0018): 9 levels, read 827789 B, fetched 919736 B in 9 single closed ranges
- patient_036_node_3 (camelyon17.c17s-0019): 9 levels, read 827789 B, fetched 919736 B in 9 single closed ranges
- patient_036_node_4 (camelyon17.c17s-0020): 9 levels, read 827789 B, fetched 919736 B in 9 single closed ranges
- patient_046_node_0 (camelyon17.c17s-0021): 9 levels, read 396445 B, fetched 431552 B in 6 single closed ranges
- patient_046_node_1 (camelyon17.c17s-0022): 9 levels, read 411925 B, fetched 496000 B in 8 single closed ranges
- patient_046_node_2 (camelyon17.c17s-0023): 9 levels, read 493877 B, fetched 527168 B in 6 single closed ranges
- patient_046_node_3 (camelyon17.c17s-0024): 9 levels, read 505477 B, fetched 604160 B in 9 single closed ranges
- patient_046_node_4 (camelyon17.c17s-0025): 8 levels, read 245612 B, fetched 306176 B in 6 single closed ranges
- patient_052_node_0 (camelyon17.c17s-0026): 9 levels, read 409381 B, fetched 444288 B in 6 single closed ranges
- patient_052_node_1 (camelyon17.c17s-0027): 9 levels, read 546245 B, fetched 676688 B in 10 single closed ranges
- patient_052_node_2 (camelyon17.c17s-0028): 9 levels, read 543813 B, fetched 592384 B in 7 single closed ranges
- patient_052_node_3 (camelyon17.c17s-0029): 8 levels, read 333332 B, fetched 420448 B in 7 single closed ranges
- patient_052_node_4 (camelyon17.c17s-0030): 9 levels, read 581253 B, fetched 612528 B in 6 single closed ranges
- patient_075_node_0 (camelyon17.c17s-0031): 9 levels, read 789533 B, fetched 882248 B in 9 single closed ranges
- patient_075_node_1 (camelyon17.c17s-0032): 9 levels, read 789533 B, fetched 915016 B in 10 single closed ranges
- patient_075_node_2 (camelyon17.c17s-0033): 9 levels, read 789533 B, fetched 865864 B in 8 single closed ranges
- patient_075_node_3 (camelyon17.c17s-0034): 9 levels, read 827789 B, fetched 903352 B in 8 single closed ranges
- patient_075_node_4 (camelyon17.c17s-0035): 9 levels, read 789533 B, fetched 882248 B in 9 single closed ranges
- patient_078_node_0 (camelyon17.c17s-0036): 9 levels, read 827789 B, fetched 870584 B in 7 single closed ranges
- patient_078_node_1 (camelyon17.c17s-0037): 9 levels, read 789533 B, fetched 865864 B in 8 single closed ranges
- patient_078_node_2 (camelyon17.c17s-0038): 9 levels, read 789533 B, fetched 833096 B in 7 single closed ranges
- patient_078_node_3 (camelyon17.c17s-0039): 9 levels, read 789533 B, fetched 865864 B in 8 single closed ranges
- patient_078_node_4 (camelyon17.c17s-0040): 9 levels, read 789533 B, fetched 833096 B in 7 single closed ranges
- patient_086_node_0 (camelyon17.c17s-0041): 10 levels, read 587491 B, fetched 637272 B in 7 single closed ranges
- patient_086_node_1 (camelyon17.c17s-0042): 9 levels, read 440634 B, fetched 494680 B in 7 single closed ranges
- patient_086_node_2 (camelyon17.c17s-0043): 9 levels, read 287152 B, fetched 364168 B in 7 single closed ranges
- patient_086_node_3 (camelyon17.c17s-0044): 10 levels, read 518539 B, fetched 569280 B in 7 single closed ranges
- patient_086_node_4 (camelyon17.c17s-0045): 10 levels, read 747891 B, fetched 762168 B in 6 single closed ranges
- patient_092_node_0 (camelyon17.c17s-0046): 10 levels, read 474178 B, fetched 476920 B in 5 single closed ranges
- patient_092_node_1 (camelyon17.c17s-0047): 10 levels, read 727635 B, fetched 0 B in 0 single closed ranges
- patient_092_node_2 (camelyon17.c17s-0048): 10 levels, read 501539 B, fetched 520024 B in 6 single closed ranges
- patient_092_node_3 (camelyon17.c17s-0049): 9 levels, read 273951 B, fetched 302632 B in 5 single closed ranges
- patient_092_node_4 (camelyon17.c17s-0050): 10 levels, read 656404 B, fetched 704360 B in 7 single closed ranges

## Pixel builder, per slide

- patient_004_node_0 (camelyon17.c17s-0001): tissueBbox [9600, 97152, 69376, 185472], thumbnail 17823 B, blankCount on levels [0, 1, 2, 3, 4, 5, 6, 7] fill [0, 0, 0]; read 432827 B (fetched 386192 B in 25 ranges)
- patient_004_node_1 (camelyon17.c17s-0002): tissueBbox [6528, 69120, 95488, 139776], thumbnail 14393 B, blankCount on levels [0, 1, 2, 3, 4, 5] fill [0, 0, 0]; read 342241 B (fetched 342241 B in 23 ranges)
- patient_004_node_2 (camelyon17.c17s-0003): tissueBbox [12160, 23552, 73472, 124416], thumbnail 24538 B, blankCount on levels [0, 1, 2, 3, 4, 5, 6, 7] fill [0, 0, 0]; read 496386 B (fetched 429783 B in 24 ranges)
- patient_004_node_3 (camelyon17.c17s-0004): tissueBbox [6912, 48512, 70656, 119424], thumbnail 19642 B, blankCount on levels [0, 1, 2, 3, 4, 5, 6, 7] fill [0, 0, 0]; read 467692 B (fetched 402403 B in 24 ranges)
- patient_004_node_4 (camelyon17.c17s-0005): tissueBbox [9600, 60416, 80000, 123008], thumbnail 24307 B, blankCount on levels [0, 1, 2, 3, 4, 5] fill [0, 0, 0]; read 448593 B (fetched 0 B in 0 ranges)
- patient_017_node_0 (camelyon17.c17s-0006): tissueBbox [384, 76288, 81664, 148480], thumbnail 14341 B, blankCount on levels [0, 1, 2, 3, 4, 5, 6, 7] fill [0, 0, 0]; read 407754 B (fetched 323811 B in 22 ranges)
- patient_017_node_1 (camelyon17.c17s-0007): tissueBbox [1408, 1536, 80768, 195840], thumbnail 23773 B, blankCount on levels [0, 1, 2, 3, 4, 5] fill [0, 0, 0]; read 451759 B (fetched 451759 B in 23 ranges)
- patient_017_node_2 (camelyon17.c17s-0008): tissueBbox [16000, 56832, 85888, 157056], thumbnail 23000 B, blankCount on levels [0, 1, 2, 3, 4, 5, 6, 7] fill [0, 0, 0]; read 489354 B (fetched 442719 B in 25 ranges)
- patient_017_node_3 (camelyon17.c17s-0009): tissueBbox [384, 86528, 74240, 189440], thumbnail 17995 B, blankCount on levels [0, 1, 2, 3, 4, 5, 6, 7] fill [0, 0, 0]; read 431017 B (fetched 355087 B in 23 ranges)
- patient_017_node_4 (camelyon17.c17s-0010): tissueBbox [2048, 22784, 75776, 114688], thumbnail 23797 B, blankCount on levels [0, 1, 2, 3, 4, 5] fill [0, 0, 0]; read 432073 B (fetched 432073 B in 23 ranges)
- patient_025_node_0 (camelyon17.c17s-0011): tissueBbox [512, 11008, 88576, 195584], thumbnail 24765 B, blankCount on levels [0, 1, 2, 3, 4] fill [0, 0, 0]; read 661097 B (fetched 650699 B in 18 ranges)  OVER the 0.6 MB per-slide budget
- patient_025_node_1 (camelyon17.c17s-0012): tissueBbox [12800, 17536, 62208, 175872], thumbnail 20466 B, blankCount on levels [0, 1, 2, 3, 4, 5, 6] fill [0, 0, 0]; read 429188 B (fetched 399893 B in 25 ranges)
- patient_025_node_2 (camelyon17.c17s-0013): tissueBbox [12416, 36992, 85376, 166144], thumbnail 22330 B, blankCount on levels [0, 1, 2, 3, 4] fill [0, 0, 0]; read 494527 B (fetched 474559 B in 18 ranges)
- patient_025_node_3 (camelyon17.c17s-0014): tissueBbox [4096, 74624, 56064, 158720], thumbnail 22272 B, blankCount on levels [0, 1, 2, 3, 4, 5, 6, 7] fill [0, 0, 0]; read 479304 B (fetched 432669 B in 26 ranges)
- patient_025_node_4 (camelyon17.c17s-0015): tissueBbox [10752, 12928, 87296, 210560], thumbnail 24319 B, blankCount on levels [0, 1, 2, 3, 4] fill [0, 0, 0]; read 523988 B (fetched 523988 B in 19 ranges)
- patient_036_node_0 (camelyon17.c17s-0016): tissueBbox [13952, 19968, 83328, 172160], thumbnail 24378 B, blankCount on levels [0, 1, 2, 3, 4, 5] fill [0, 0, 0]; read 483633 B (fetched 472920 B in 22 ranges)
- patient_036_node_1 (camelyon17.c17s-0017): tissueBbox [256, 11904, 88448, 198912], thumbnail 24337 B, blankCount on levels [0, 1, 2, 3] fill [0, 0, 0]; read 606142 B (fetched 566459 B in 12 ranges)  OVER the 0.6 MB per-slide budget
- patient_036_node_2 (camelyon17.c17s-0018): tissueBbox [14720, 1792, 94336, 196352], thumbnail 24351 B, blankCount on levels [0, 1, 2, 3, 4] fill [0, 0, 0]; read 661849 B (fetched 661849 B in 19 ranges)  OVER the 0.6 MB per-slide budget
- patient_036_node_3 (camelyon17.c17s-0019): tissueBbox [768, 12160, 76800, 195328], thumbnail 24746 B, blankCount on levels [0, 1, 2, 3, 4] fill [0, 0, 0]; read 632251 B (fetched 611720 B in 17 ranges)  OVER the 0.6 MB per-slide budget
- patient_036_node_4 (camelyon17.c17s-0020): tissueBbox [6784, 12160, 93952, 176512], thumbnail 24057 B, blankCount on levels [0, 1, 2, 3] fill [0, 0, 0]; read 594675 B (fetched 581392 B in 14 ranges)
- patient_046_node_0 (camelyon17.c17s-0021): tissueBbox [1024, 2944, 102016, 90432], thumbnail 24220 B, blankCount on levels [] fill None; read 1305889 B (fetched 1305889 B in 17 ranges)  OVER the 0.6 MB per-slide budget
- patient_046_node_1 (camelyon17.c17s-0022): tissueBbox [4992, 1408, 105792, 90304], thumbnail 24198 B, blankCount on levels [] fill None; read 1030982 B (fetched 1030982 B in 17 ranges)  OVER the 0.6 MB per-slide budget
- patient_046_node_2 (camelyon17.c17s-0023): tissueBbox [0, 0, 114368, 102784], thumbnail 21852 B, blankCount on levels [] fill None; read 1342314 B (fetched 1342314 B in 21 ranges)  OVER the 0.6 MB per-slide budget
- patient_046_node_3 (camelyon17.c17s-0024): tissueBbox [3008, 0, 131072, 93184], thumbnail 23133 B, blankCount on levels [] fill None; read 941411 B (fetched 941411 B in 17 ranges)  OVER the 0.6 MB per-slide budget
- patient_046_node_4 (camelyon17.c17s-0025): tissueBbox [2112, 640, 65536, 88960], thumbnail 24847 B, blankCount on levels [] fill None; read 634094 B (fetched 634094 B in 8 ranges)  OVER the 0.6 MB per-slide budget
- patient_052_node_0 (camelyon17.c17s-0026): tissueBbox [1664, 0, 93376, 97280], thumbnail 23067 B, blankCount on levels [] fill None; read 1059268 B (fetched 1059268 B in 17 ranges)  OVER the 0.6 MB per-slide budget
- patient_052_node_1 (camelyon17.c17s-0027): tissueBbox [4352, 0, 125440, 103616], thumbnail 23328 B, blankCount on levels [] fill None; read 1576975 B (fetched 1576975 B in 21 ranges)  OVER the 0.6 MB per-slide budget
- patient_052_node_2 (camelyon17.c17s-0028): tissueBbox [12864, 0, 128896, 89792], thumbnail 20607 B, blankCount on levels [] fill None; read 1194470 B (fetched 1182564 B in 20 ranges)  OVER the 0.6 MB per-slide budget
- patient_052_node_3 (camelyon17.c17s-0029): tissueBbox [18624, 10048, 84160, 81536], thumbnail 22676 B, blankCount on levels [] fill None; read 688746 B (fetched 688746 B in 13 ranges)  OVER the 0.6 MB per-slide budget
- patient_052_node_4 (camelyon17.c17s-0030): tissueBbox [6144, 0, 135168, 103936], thumbnail 24465 B, blankCount on levels [] fill None; read 500917 B (fetched 490869 B in 7 ranges)
- patient_075_node_0 (camelyon17.c17s-0031): tissueBbox [12544, 85504, 89600, 165376], thumbnail 23775 B, blankCount on levels [0, 1, 2, 3, 4, 5] fill [0, 0, 0]; read 422067 B (fetched 412740 B in 22 ranges)
- patient_075_node_1 (camelyon17.c17s-0032): tissueBbox [23936, 71040, 95488, 180608], thumbnail 23784 B, blankCount on levels [0, 1, 2, 3, 4, 5, 6] fill [0, 0, 0]; read 569263 B (fetched 569263 B in 27 ranges)
- patient_075_node_2 (camelyon17.c17s-0033): tissueBbox [21760, 59264, 88960, 126976], thumbnail 22729 B, blankCount on levels [0, 1, 2, 3, 4, 5, 6, 7] fill [0, 0, 0]; read 496108 B (fetched 458800 B in 27 ranges)
- patient_075_node_3 (camelyon17.c17s-0034): tissueBbox [27136, 59904, 84352, 195584], thumbnail 19017 B, blankCount on levels [0, 1, 2, 3, 4, 5, 6] fill [0, 0, 0]; read 416261 B (fetched 372536 B in 24 ranges)
- patient_075_node_4 (camelyon17.c17s-0035): tissueBbox [1024, 48256, 92288, 175488], thumbnail 23199 B, blankCount on levels [0, 1, 2, 3, 4, 5] fill [0, 0, 0]; read 477430 B (fetched 439985 B in 19 ranges)
- patient_078_node_0 (camelyon17.c17s-0036): tissueBbox [7168, 118144, 86144, 195328], thumbnail 23990 B, blankCount on levels [0, 1, 2, 3, 4, 5, 6, 7] fill [0, 0, 0]; read 508690 B (fetched 452728 B in 25 ranges)
- patient_078_node_1 (camelyon17.c17s-0037): tissueBbox [5120, 93184, 87040, 182144], thumbnail 23713 B, blankCount on levels [0, 1, 2, 3, 4, 5, 6] fill [0, 0, 0]; read 574989 B (fetched 546731 B in 25 ranges)
- patient_078_node_2 (camelyon17.c17s-0038): tissueBbox [18048, 896, 70912, 155776], thumbnail 24995 B, blankCount on levels [0, 1, 2, 3, 4, 5] fill [0, 0, 0]; read 447616 B (fetched 447616 B in 23 ranges)
- patient_078_node_3 (camelyon17.c17s-0039): tissueBbox [18432, 103424, 70272, 183168], thumbnail 20894 B, blankCount on levels [0, 1, 2, 3, 4, 5, 6] fill [0, 0, 0]; read 443862 B (fetched 425046 B in 26 ranges)
- patient_078_node_4 (camelyon17.c17s-0040): tissueBbox [12032, 60800, 90752, 186112], thumbnail 23779 B, blankCount on levels [0, 1, 2, 3, 4] fill [0, 0, 0]; read 468861 B (fetched 468861 B in 19 ranges)
- patient_086_node_0 (camelyon17.c17s-0041): tissueBbox [3328, 10240, 140288, 92288], thumbnail 6897 B, blankCount on levels [] fill None; read 138037 B (fetched 127135 B in 7 ranges)
- patient_086_node_1 (camelyon17.c17s-0042): tissueBbox [768, 704, 80704, 90880], thumbnail 20913 B, blankCount on levels [] fill None; read 425873 B (fetched 412827 B in 14 ranges)
- patient_086_node_2 (camelyon17.c17s-0043): tissueBbox [3776, 2688, 76800, 78400], thumbnail 13646 B, blankCount on levels [] fill None; read 323180 B (fetched 315211 B in 13 ranges)
- patient_086_node_3 (camelyon17.c17s-0044): tissueBbox [42368, 19968, 155008, 62592], thumbnail 4549 B, blankCount on levels [] fill None; read 90382 B (fetched 81952 B in 7 ranges)
- patient_086_node_4 (camelyon17.c17s-0045): tissueBbox [2176, 10240, 175360, 94720], thumbnail 9567 B, blankCount on levels [] fill None; read 169734 B (fetched 156709 B in 8 ranges)
- patient_092_node_0 (camelyon17.c17s-0046): tissueBbox [2304, 3840, 110848, 56832], thumbnail 5568 B, blankCount on levels [] fill None; read 112067 B (fetched 107129 B in 5 ranges)
- patient_092_node_1 (camelyon17.c17s-0047): tissueBbox [71680, 4480, 151936, 89344], thumbnail 6562 B, blankCount on levels [] fill None; read 129467 B (fetched 0 B in 0 ranges)
- patient_092_node_2 (camelyon17.c17s-0048): tissueBbox [11648, 3712, 134272, 80128], thumbnail 7244 B, blankCount on levels [] fill None; read 132976 B (fetched 122454 B in 7 ranges)
- patient_092_node_3 (camelyon17.c17s-0049): tissueBbox [2688, 35456, 85824, 62656], thumbnail 8931 B, blankCount on levels [5] fill [254, 254, 254]; read 216035 B (fetched 199128 B in 16 ranges)
- patient_092_node_4 (camelyon17.c17s-0050): tissueBbox [5504, 1536, 164352, 77184], thumbnail 7057 B, blankCount on levels [] fill None; read 145137 B (fetched 134803 B in 8 ranges)

`total read 26949451 B (fetched 25446982 B) for 50 slides; budget 600000 B per slide, 40000000 B in all`

> note: a slide over the per-slide budget is reported, not refused (the pinned levels alone can exceed 0.5 MB on dense centre-1 slides); the 40 MB total is enforced

## Overlays, catalogue and cases (no bucket reads; the 12 XML files from the cache, md5-checked against checksums.md5)

```
overlays/patient_004_node_4.geojson: up to date · 3 features (3 Tumor), largest polygon 124.7 µm, 3 cluster(s), span 124.7 µm, area 0.0149 mm², 4,148 B
overlays/patient_017_node_1.geojson: up to date · 1 features (1 Tumor), largest polygon 83.6 µm, 1 cluster(s), span 83.6 µm, area 0.0024 mm², 2,488 B
overlays/patient_017_node_2.geojson: up to date · 17 features (17 Tumor), largest polygon 3157.9 µm, 5 cluster(s), span 3157.9 µm, area 7.7642 mm², 37,406 B
overlays/patient_017_node_4.geojson: up to date · 20 features (20 Tumor), largest polygon 775.7 µm, 6 cluster(s), span 925.7 µm, area 0.5215 mm², 21,256 B
overlays/patient_036_node_3.geojson: up to date · 6 features (6 Tumor), largest polygon 788.9 µm, 6 cluster(s), span 788.9 µm, area 0.4754 mm², 10,509 B
overlays/patient_046_node_3.geojson: up to date · 3 features (3 Tumor), largest polygon 1126.5 µm, 2 cluster(s), span 1126.5 µm, area 0.7773 mm², 11,854 B
overlays/patient_046_node_4.geojson: up to date · 78 features (78 Tumor), largest polygon 193.6 µm, 15 cluster(s), span 779.0 µm, area 0.1300 mm², 80,848 B
overlays/patient_052_node_1.geojson: up to date · 42 features (42 Tumor), largest polygon 3009.3 µm, 7 cluster(s), span 3287.6 µm, area 5.1429 mm², 69,575 B
overlays/patient_075_node_4.geojson: up to date · 34 features (34 Tumor), largest polygon 4077.5 µm, 14 cluster(s), span 4077.5 µm, area 12.6108 mm², 51,718 B
overlays/patient_086_node_0.geojson: up to date · 2 features (2 Tumor), largest polygon 58.7 µm, 1 cluster(s), span 111.5 µm, area 0.0022 mm², 3,517 B
overlays/patient_086_node_4.geojson: up to date · 2 features (2 Tumor), largest polygon 72.8 µm, 1 cluster(s), span 128.0 µm, area 0.0024 mm², 3,487 B
overlays/patient_092_node_1.geojson: up to date · 4 features (4 Tumor), largest polygon 3154.1 µm, 1 cluster(s), span 3255.5 µm, area 5.8427 mm², 13,596 B
build_signout_catalogue: data/signout/catalogue.json is up to date
build_signout_cases --check: 22 of 22 files up to date
```
