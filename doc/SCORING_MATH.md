# The mathematics of the score

This document explains, formula by formula, how a zone's score is computed: from the raw
data to the indicator values, then to barriers, dimension barriers, the score of a
profile, its colour class, and the city-wide figures. Every number used below comes from
[`zone.config.json`](../atlas/src/domain/zone/zone.config.json); every formula is the one
in the code, and the section titles name the function that implements it.

The overview of the pipeline is in the [developer guide](DEVELOPER_GUIDE.md#5-the-scoring-model);
this is the detailed version.

---

## 0. Notation

| Symbol | Meaning |
|---|---|
| $z$ | a zone (one IRIS) |
| $i$ | an indicator (`steps`, `noise`, ...) |
| $d$ | a dimension: physical, sensory, cognitive, economic, socio_cultural, political |
| $p$ | a profile (`wheelchair`, `blind`, `allophone`, `low_income`) |
| $v_i$ | the value of indicator $i$ for the zone (may be **missing**) |
| $b_i \in [0,1]$ | the barrier of indicator $i$: 0 = no problem, 1 = total obstacle |
| $B_d \in [0,1]$ | the barrier of dimension $d$ |
| $w_{p,d} \ge 0$ | the weight of dimension $d$ for profile $p$, with $\sum_d w_{p,d} = 1$ |
| $S_p \in [0,1]$ | the score of the zone for profile $p$: 0 = inaccessible, 1 = no obstacle |
| $L$ | the street length of the zone, in km |
| $\mathrm{clamp}(x)$ | $\min(1, \max(0, x))$ |

**Missing is not zero.** When the data cannot support an indicator, $v_i$ is *missing*:
it is absent from `zone.values`, its barrier is `null`, and it is skipped by every sum,
mean and product below. Each formula says what happens when its inputs are missing.

---

## 1. From the data to the indicator values (`buildZones`, `withSlope`)

### 1.1 Geometric tools

* **Distance** between two points: the haversine formula on a sphere of radius
  $R = 6\,371\,008.8$ m (`distanceM`). A street's length is the sum over its segments.
* **Local flat projection** (for areas and grids). Around Marseille's latitude
  $\varphi_0 = 43.28°$, one degree is worth
  $k_y = 110\,540$ m of latitude and $k_x = 111\,320 \cos\varphi_0 \approx 81\,060$ m of
  longitude, so $(x, y) = (k_x \lambda,\ k_y \varphi)$. The error over the whole city is a
  fraction of a percent.
* **Area and centroid** (`areaAndCentroid`): the shoelace formula on the projected rings.
  For a ring of vertices $(x_k, y_k)$:
  $$A = \tfrac12 \sum_k (x_k y_{k+1} - x_{k+1} y_k), \qquad
    c_x = \frac{1}{6A}\sum_k (x_k + x_{k+1})(x_k y_{k+1} - x_{k+1} y_k)$$
  and likewise $c_y$. Holes are subtracted; a multi-polygon's centroid is the
  area-weighted mean of its parts.
* **Point in polygon** (`PolygonIndex.at`): the even-odd ray-casting test across every
  ring, so a point inside a hole is outside. A spatial grid limits each test to the
  polygons whose bounding box can contain the point.
* **Which zone an object belongs to**: a point belongs to the zone that contains it. A
  line or polygon from OpenStreetMap is represented by one point (`anchorOf`): the middle
  vertex of a line, the mean of the vertices of a polygon. **A whole street is counted
  in the zone that contains its middle vertex.**
* **Sampling an area**: a regular lattice of points every $g$ metres
  ($g$ = `sampleGridM` = 100 m for noise and participation, `terrainGridM` = 200 m for the
  altitudes). Each lattice point belongs to the zone it falls in, so a zone of area $A$ has
  about $A / g^2$ points.

### 1.2 Street length and densities

$L$ is the summed length (km) of the ways whose `highway` tag is in `streetHighways`,
minus hiking trails (`excludeTrails`). Most counts are turned into **densities per km of
street**:

$$v_i = \frac{n_i}{L} \qquad \text{only if } L \ge L_{\min} = \texttt{minStreetKm} = 1 \text{ km, otherwise missing.}$$

Dividing by street length rather than by area keeps a large zone (a park, a hill) from
looking better or worse just for its size, and the threshold avoids absurd densities over
a few hundred metres of street.

A density indicator is also left out entirely when the city has **no** object of that
kind at all (for example no bench anywhere in the data): that means the data does not
record it, not that every zone has none.

### 1.3 Every indicator

| Indicator | Value $v_i$ | Missing when |
|---|---|---|
| `steps` | flights of steps with no `ramp` / `ramp:wheelchair` tag, per km | $L < 1$ |
| `slope` | mean slope (%) between neighbouring altitude points of the zone (see 1.4) | fewer than 3 pairs |
| `surface` | length-weighted mean roughness $\sum_k r(s_k)\,\ell_k / \sum_k \ell_k$ over the ways with a surface listed in `surfaceRoughness` | less than 100 m of such ways |
| `rest` | benches per km | $L<1$ or no bench in the city |
| `transit` | number of distinct modes (bus, tram, metro) with a stop in the zone: 0..3 | no transit file |
| `parkingReports`, `narrowReports`, `worksReports`, `furnitureReports` | citizens' reports of that kind per km | $L < 1$ or no reports file |
| `noise` | mean over the zone's lattice points of $\text{band} + 2.5$ dB, or $52.5$ dB where no band covers the point | no noise map |
| `crossings` | $1 - n_\text{equipped}/n_\text{crossings}$, equipped = traffic lights or tactile paving | no crossing |
| `glare` | length-weighted mean of `surfaceGlare`, as for `surface` | less than 100 m |
| `signage` | guideposts, boards and maps per km | $L<1$ or none in the city |
| `lighting` | $\ell_{\text{lit=no}} / \ell_{\text{lit tagged}}$ | less than 200 m tagged |
| `legibility` | length-weighted mean sinuosity $\sum_k (\ell_k/c_k)\,\ell_k / \sum_k \ell_k$, where $c_k$ is the straight distance between the ends of way $k$ (ways with $c_k \ge 10$ m) | less than 200 m |
| `landmarks` | shops, amenities, tourism, historic objects, bus stops per km | $L<1$ or none |
| `infoCentres` | distance (m) from the centroid to the nearest tourist office | none in the data |
| `publicPrivate` | $n_\text{private} / (n_\text{private} + n_\text{free})$ | no such place |
| `freeServices` | free water, toilets, libraries, community centres per km | $L<1$ or none |
| `poverty` | % of households under the poverty line (INSEE 2014) | not published for the IRIS |
| `shelter` | shelters, covered ways, arcades per km | $L<1$ or none |
| `surveillance` | cameras and gates per km | $L<1$ or none |
| `coPresence` | $1 - n_{\text{width} \ge 1.5\,\text{m}} / n_\text{width tagged}$ | fewer than 5 tagged ways |
| `activities` | cafes, libraries, parks, places of worship... per km | $L<1$ or none |
| `participation` | $0.5 \times$ share of the zone's lattice points outside every QPV and urban-project perimeter | no perimeter file |
| `civic` | distance (m) from the centroid to the nearest town hall, community or social centre | none in the data |

**Noise.** The official map gives polygons by 5 dB band ($\ge 55$, $\ge 60$, ...). A point's
level is estimated at the middle of its band ($\text{band} + 2.5$); a point outside every
band is below 55 dB and is counted as $52.5$. Where bands overlap, the highest wins.

**Distances** (`infoCentres`, `civic`) are searched within 1, 3 and then 10 km of the
centroid; beyond 10 km the value is 10,000 m (which is past the "total obstacle" point
anyway).

### 1.4 Slope (`withSlope`)

The altitudes $h$ come from IGN on a 200 m lattice. For every lattice point $(i, j)$ of a
zone and each of its east and north neighbours that lie **in the same zone**:

$$\text{slope}_{(i,j)\to(i',j')} = \frac{|h_{i',j'} - h_{i,j}|}{200\ \text{m}} \times 100 \ \%$$

The zone's `slope` is the mean of these values, provided there are at least 3 of them.
This is a mean terrain gradient, not the gradient of each street.

---

## 2. From a value to a barrier (`computeBarriers`, `linearBarrier`)

Each indicator has a `kind`.

### 2.1 `linear` and `evidence`: a clamped straight line

With $a$ = `noProblemAt` and $c$ = `totalObstacleAt`:

$$b_i = \mathrm{clamp}\!\left(\frac{v_i - a}{c - a}\right)$$

* $v_i = a \Rightarrow b_i = 0$, $v_i = c \Rightarrow b_i = 1$, straight in between, flat
  outside.
* It works in both directions. For "more is worse" (steps, noise) $c > a$; for "more is
  better" (benches, landmarks) $c < a$ and the fraction flips sign by itself.

Examples with the shipped config:

| Indicator | $a$ | $c$ | $v_i$ | $b_i$ |
|---|---:|---:|---:|---|
| `noise` | 55 dB | 85 dB | 64 dB | $(64-55)/30 = 0.30$ |
| `rest` | 3 /km | 0 /km | 1.5 /km | $(1.5-3)/(0-3) = 0.50$ |
| `transit` | 2 modes | 0 | 1 mode | $(1-2)/(0-2) = 0.50$; 2 or 3 modes $\to 0$ |
| `slope` | 4 % | 12 % | 6 % | $(6-4)/8 = 0.25$ |
| `steps` | 0 /km | 6 /km | 9 /km | $\mathrm{clamp}(1.5) = 1$ |

### 2.2 `share`

The value already is a proportion of the problem (unequipped crossings, unlit length...),
so $b_i = \mathrm{clamp}(v_i)$.

### 2.3 Missing values

A missing $v_i$ gives a missing $b_i$ (`barrier: null`). It is never replaced by 0, which
would claim "no problem", nor by 1, which would claim "total obstacle".

---

## 3. From barriers to a dimension barrier (`dimensionBarriers`)

Let $O_d$ be the **ordinary** (`linear`, `share`) indicators of dimension $d$ that have a
barrier, and $E_d$ the **evidence** indicators of $d$ that have one.

$$
B_d \;=\; 1 \;-\; \underbrace{\left(1 - \frac{1}{|O_d|}\sum_{i \in O_d} b_i\right)}_{\text{open data: mean}}
\;\times\; \underbrace{\prod_{j \in E_d} \left(1 - b_j\right)}_{\text{reports: compounded}}
$$

* If $O_d$ is empty the first factor is 1, so $B_d = 1 - \prod_j (1 - b_j)$.
* If both are empty, the dimension has **no data**: $B_d$ is missing.

**Why a mean for the open data?** The indicators of a dimension are different views of
the same quality (steps, slope, benches, transit for D1). Averaging keeps one weak
indicator from deciding the dimension on its own, and a missing indicator simply drops
out of the mean.

**Why a product for the reports?** The citizens' reports are evidence of an obstacle, not
a measure of its absence: a street with no report is not proven fine. Each evidence
indicator is treated as one more independent obstacle stacked on top of the open-data
estimate, the same way independent probabilities of passing combine:

$$P(\text{pass}) = P(\text{pass the open-data obstacles}) \times \prod_j P(\text{pass obstacle } j)$$

The consequences: a report can only **raise** $B_d$ (each factor is $\le 1$); a zone with
no reports keeps exactly its open-data barrier ($b_j = 0 \Rightarrow$ factor 1); and a few
reports can never make a zone look better than the open data alone, which a mean would
do.

---

## 4. From dimension barriers to the score of a profile (`scoreZone`)

Let $D_p$ be the dimensions with $w_{p,d} > 0$ **and** a barrier $B_d$. With
$\kappa$ = `dimensionBarrierCap` = 0.9 and $W_p = \sum_{d \in D_p} w_{p,d}$:

$$
\boxed{\;S_p \;=\; \prod_{d \in D_p} \bigl(1 - \min(B_d, \kappa)\bigr)^{\,w_{p,d} / W_p}\;}
$$

If $D_p$ is empty, $S_p$ is missing ("pas assez de donnees").

This is a **weighted geometric mean** of the "passabilities" $1 - B_d$. Taking logarithms
shows it as a weighted mean of logs:

$$\ln S_p = \sum_{d \in D_p} \frac{w_{p,d}}{W_p}\,\ln\bigl(1 - \min(B_d, \kappa)\bigr)$$

### 4.1 Why a product rather than an average

The memoire states that the barriers "ne s'additionnent pas : elles composent un
systeme". A product encodes exactly that:

* **A bad dimension cannot be bought back.** With an arithmetic mean, excellent
  sensory and cognitive conditions would compensate for an impassable street. In the
  product, a factor near 0 pulls the whole score down whatever the others are.
* **The pull grows as the dimension gets worse.** The sensitivity is
  $$\frac{\partial \ln S_p}{\partial B_d} = -\,\frac{w_{p,d}/W_p}{1 - B_d}$$
  so the same step of worsening costs more on a dimension that is already bad (at
  $B_d = 0.8$ it costs five times what it costs at $B_d = 0$).
* **The geometric mean is never above the arithmetic one** (AM-GM inequality), with
  equality only when all dimensions are equal. The more unequal the dimensions, the
  bigger the gap: inequality between dimensions is itself penalised.

### 4.2 Why the weights are rescaled

$w_{p,d} / W_p$ re-normalises the weights over the dimensions that have data, so the
exponents always add up to 1. Without it, a missing dimension would act as a factor of
$1^{w} = 1$, which is the same as declaring it perfect. Rescaling instead reads as "judge
the zone on what is known, in the same proportions".

Example: the wheelchair profile weights political at 0.15. If political has no data,
$W_p = 0.85$ and the physical exponent becomes $0.35 / 0.85 \approx 0.412$ instead of 0.35.

### 4.3 Why the cap

Without the cap, one dimension at its worst ($B_d = 1$) gives a factor of $0^{w} = 0$ and
the score is exactly 0 however good everything else is. Every zone with one saturated
indicator would then be tied at 0 and could not be ranked. Capping at $\kappa = 0.9$ keeps
every factor at least $0.1^{w/W}$:

* the score of a zone with data stays within $[\,1-\kappa,\ 1\,] = [0.1, 1]$; it reaches 0.1
  only when **every** dimension is at or above the cap;
* zones that are very bad on one dimension are still told apart by their other dimensions.

The cap is applied to the score only. The dimension scores on the map and in the
dashboard (section 6) use the uncapped $B_d$.

### 4.4 Properties worth knowing

* **Monotonic**: raising any indicator's barrier can never raise the score.
* **Bounded**: $S_p \in [1-\kappa, 1]$ whenever it exists.
* **Unit-free**: every indicator is reduced to $[0,1]$ before it is combined, so the
  units (dB, %, metres, counts per km) never mix.
* **Profile-independent up to the weights**: $b_i$ and $B_d$ are the same for every
  profile; only $w_{p,d}$ changes. Comparing two profiles on one zone therefore compares
  priorities, not measurements.

---

## 5. Classes and colours (`classify`, `gradientColour`)

The score is classed against two thresholds from `classes`:

$$
\text{class}(S) =
\begin{cases}
\text{red} & S < 0.42 \\
\text{orange} & 0.42 \le S < 0.56 \\
\text{green} & S \ge 0.56 \\
\text{none} & S \text{ missing}
\end{cases}
$$

The thresholds were set so that about a fifth of the zones are red: a red zone is
"worse than most of Marseille" for that profile, not "unusable". The same classes apply
to each dimension layer, using the dimension score $1 - B_d$.

On the map the fill colour is a continuous scale, a piecewise-linear interpolation in RGB
between four stops (`GRADIENT` in `zoneLayers.ts`):

| $S$ | $\le 0.35$ | 0.5 | 0.6 | $\ge 0.75$ |
|---|---|---|---|---|
| colour | red `#b91c1c` | orange `#e8590c` | yellow `#eab308` | green `#15803d` |

For $S$ between two stops $(s_0, C_0)$ and $(s_1, C_1)$, each RGB channel is
$C_0 + (C_1 - C_0)\,\frac{S - s_0}{s_1 - s_0}$. Red-class zones are also outlined with a
dashed line, so the class does not rely on colour alone.

---

## 6. City-wide figures (`dimensionScores`)

The "Score par dimension" bars in the Analyse tab, and those of a zone in the inspector,
aggregate over a set of zones $Z$, weighting each zone by its area $A_z$ and counting only
the zones with data for that dimension, $Z_d \subseteq Z$:

$$
\text{score}_d = \frac{\sum_{z \in Z_d} A_z\,(1 - B_{d,z})}{\sum_{z \in Z_d} A_z},
\qquad
\text{coverage}_d = \frac{\sum_{z \in Z_d} A_z}{\sum_{z \in Z} A_z}
$$

The score is missing when $Z_d$ is empty. The coverage is shown beside the score: a
dimension score built on 30 % of the city is a weaker statement than one built on 100 %.
The dashboard's area per class sums $A_z$ by the class of $S_p$.

---

## 7. Ranking (`rankZones`)

Only zones of type `habitat` with a score are ranked, by increasing $S_p$; ties go to the
larger zone. For each ranked zone:

* **main causes**: the three indicators with the highest $b_i > 0$;
* **weakest dimension**: $\arg\max_d B_d$;
* **basis**: the share of its non-missing indicators coming from each source
  (OSM, official data, reports), $n_\text{source} / n_\text{known}$.

---

## 8. Worked example

A zone with these values (no political data):

| Dimension | Indicator | $v_i$ | Rule | $b_i$ |
|---|---|---:|---|---:|
| physical | `steps` | 3 /km | 0 -> 6 | 0.50 |
| | `slope` | 6 % | 4 -> 12 | 0.25 |
| | `rest` | 1.5 /km | 3 -> 0 | 0.50 |
| | `transit` | 1 mode | 2 -> 0 | 0.50 |
| | `parkingReports` *(evidence)* | 2 /km | 0 -> 4 | 0.50 |
| | `narrowReports` *(evidence)* | 0 /km | 0 -> 3 | 0.00 |
| | `worksReports` *(evidence)* | 0.3 /km | 0 -> 1.5 | 0.20 |
| sensory | `noise` | 64 dB | 55 -> 85 | 0.30 |
| | `crossings` | 0.4 | share | 0.40 |
| | `lighting` | 0.2 | share | 0.20 |
| cognitive | `legibility` | 1.2 | 1.1 -> 1.6 | 0.20 |
| | `landmarks` | 9 /km | 15 -> 0 | 0.40 |
| economic | `publicPrivate` | 0.6 | share | 0.60 |
| | `freeServices` | 0.3 /km | 0.6 -> 0 | 0.50 |
| social | `poverty` | 27 % | 15 -> 45 | 0.40 |
| | `shelter` | 0.5 /km | 1 -> 0 | 0.50 |

**Dimension barriers (section 3).**

* Physical: open-data mean $= (0.5 + 0.25 + 0.5 + 0.5)/4 = 0.4375$; reports
  $\prod (1-b_j) = 0.5 \times 1 \times 0.8 = 0.4$; so
  $B_\text{phys} = 1 - (1 - 0.4375) \times 0.4 = 1 - 0.225 = 0.775$.
  Without the reports it would be 0.4375: they nearly double the obstacle.
* Sensory: $(0.3 + 0.4 + 0.2)/3 = 0.30$. Cognitive: $(0.2 + 0.4)/2 = 0.30$.
* Economic: $(0.6 + 0.5)/2 = 0.55$. Social: $(0.4 + 0.5)/2 = 0.45$.
* Political: no data, so it is left out.

**Score for the wheelchair profile (section 4).** Weights 0.35, 0.10, 0.10, 0.15, 0.15
(political, 0.15, is missing), so $W_p = 0.85$:

| Dimension | $1 - B_d$ | exponent $w/W_p$ | factor |
|---|---:|---:|---:|
| physical | 0.225 | 0.4118 | 0.5411 |
| sensory | 0.700 | 0.1176 | 0.9589 |
| cognitive | 0.700 | 0.1176 | 0.9589 |
| economic | 0.450 | 0.1765 | 0.8686 |
| social | 0.550 | 0.1765 | 0.8999 |

$$S_\text{wheelchair} = 0.5411 \times 0.9589 \times 0.9589 \times 0.8686 \times 0.8999 \approx 0.389 \;\Rightarrow\; \textbf{red}\ (< 0.42)$$

For comparison, a weighted *arithmetic* mean of the same $1 - B_d$ would give 0.434,
which is orange: averaging would let the good sensory and cognitive conditions hide a
physical barrier of 0.775, which is exactly what the product is there to prevent.

**Same zone, low-income profile.** Weights 0.15, 0.05, 0.10, 0.40, 0.20 (political, 0.10,
is missing), $W_p = 0.90$. The economic dimension now carries the largest exponent
(0.444) and the physical one a small exponent (0.167):
$S_\text{low income} \approx 0.451$, **orange**. Same measurements, different priorities.

These figures are what `scoreZone` returns for these inputs; the "Verifier un calcul"
panel of the app shows the same table for any zone that is clicked.

---

## 9. Where each formula lives

| Section | Function | File |
|---|---|---|
| 1 | `buildZones`, `withSlope`, `terrainPoints` | `atlas/src/domain/zone/build.ts` |
| 1.1 | `distanceM`, `KX`/`KY`, `areaAndCentroid`, `anchorOf`, `PolygonIndex` | `geo.ts`, `zoneGeometry.ts`, `spatial.ts` |
| 1.3 | `bandAt` (noise) | `noiseMap.ts` |
| 2 | `linearBarrier`, `computeBarriers` | `score.ts` |
| 3 | `dimensionBarriers` | `score.ts` |
| 4 | `scoreZone`, `scoreAllProfiles` | `score.ts` |
| 5 | `classify`; `gradientColour`, `GRADIENT` | `score.ts`; `atlas/src/app/zone/zoneLayers.ts` |
| 6 | `dimensionScores`, `dimensionScoreOf` | `dimensionScores.ts` |
| 7 | `rankZones` | `ranking.ts` |

The tests in `atlas/src/domain/zone/__tests__/zone.test.ts` check each of these properties
(clamping in both directions, missing data never 0, compounding of the evidence, the cap,
area weighting, ranking order). If you change a formula, change this document and those
tests together.
