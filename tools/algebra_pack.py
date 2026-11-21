#!/usr/bin/env python3
"""Generate reproducible, worked Algebra I and II examples as ZIP/JSONL."""

import argparse
import json
import random
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


CONCEPTS = [
    ("What is slope?", "Slope measures how much y changes per unit change in x. For two points, divide the change in y by the change in x: m = (y₂ − y₁) / (x₂ − x₁). For example, from (1, 2) to (4, 8), the slope is (8 − 2) / (4 − 1) = 2. A vertical line has undefined slope."),
    ("How do I factor a quadratic?", "For x² + bx + c, look for two numbers whose sum is b and whose product is c. For x² + 5x + 6, the numbers are 2 and 3, so the factorization is (x + 2)(x + 3). Expand the factors to check. If the leading coefficient is not 1, try grouping or use the quadratic formula to find the roots."),
    ("What is the quadratic formula?", "For ax² + bx + c = 0 with a ≠ 0, the roots are x = (−b ± √(b² − 4ac)) / (2a). The discriminant b² − 4ac tells you whether the equation has two distinct real roots, one repeated real root, or two complex roots."),
    ("How do I solve a system of equations?", "Use substitution when one equation is already solved for a variable. Use elimination when adding or subtracting the equations can cancel a variable. For y = 2x + 1 and x + y = 7, substitute to get 3x + 1 = 7, so x = 2 and y = 5. Check both values in both original equations."),
    ("Why does an inequality sign flip?", "Multiplying or dividing both sides by a negative reverses the order. For example, 2 < 5, but multiplying by −1 gives −2 > −5. To solve −3x < 12, divide by −3 and reverse the sign to get x > −4."),
    ("How do I find the inverse of a function?", "Write y = f(x), swap x and y, then solve for y. If f(x) = 3x + 5, swap to get x = 3y + 5 and solve y = (x − 5) / 3. A function needs to be one-to-one on its domain for its inverse to be a function."),
    ("What is a logarithm?", "A logarithm is an exponent. log base b of N equals x exactly when bˣ = N, for b > 0, b ≠ 1, and N > 0 in the real numbers. For example, log base 2 of 8 equals 3 because 2³ = 8."),
    ("What is an arithmetic sequence?", "An arithmetic sequence changes by a constant amount called the common difference. Its nth term is aₙ = a₁ + (n − 1)d. In 4, 7, 10, …, the first term is 4 and the common difference is 3."),
    ("What is a geometric sequence?", "In a geometric sequence, multiply each term by the common ratio r to get the next term. Its nth term is aₙ = a₁rⁿ⁻¹. In 3, 6, 12, …, the common ratio is 2."),
    ("What is the remainder theorem?", "When you divide a polynomial P(x) by x − c, the remainder is P(c). If P(c) = 0, then x − c is a factor. For P(x) = x² − 5 and divisor x − 2, the remainder is P(2) = −1."),
    ("How do I solve an absolute value equation?", "For |A| = k and k > 0, solve A = k and A = −k. If k = 0, solve A = 0. A negative k gives no real solution. For |x − 3| = 5, the two solutions are x = 8 and x = −2."),
    ("What is exponential growth?", "A quantity grows exponentially if it is multiplied by the same factor on each equal time interval. For y = a(1 + r)ᵗ, a is the starting quantity and r is the growth rate per period. A 5% growth rate gives a multiplier of 1.05.")
]


def signed(value):
    return f"+ {value}" if value >= 0 else f"− {-value}"


def exercise(kind, rng):
    x = rng.randint(-36, 36)
    y = rng.randint(-36, 36)
    a = rng.randint(2, 15)
    b = rng.randint(-24, 24)
    c = rng.randint(2, 15)

    if kind == 0:
        right = a * x + b
        return (f"Solve for x: {a}x {signed(b)} = {right}.",
                f"Subtract {b} from both sides to get {a}x = {right - b}. Divide by {a}: x = {x}. Check by substituting: {a}({x}) {signed(b)} = {right}.")
    if kind == 1:
        right = -a * x + b
        return (f"Solve the inequality −{a}x {signed(b)} < {right}.",
                f"Subtract {b} from both sides: −{a}x < {right - b}. Divide by −{a} and reverse the inequality. The answer is x > {x}.")
    if kind == 2:
        run = rng.randint(2, 13)
        x2, y2 = x + run, y + b * run
        return (f"Find the slope through ({x}, {y}) and ({x2}, {y2}).",
                f"Slope is rise over run. The rise is {y2} − ({y}) = {b * run} and the run is {x2} − ({x}) = {run}. The slope is {b}.")
    if kind == 3:
        total, weighted = x + y, a * x + y
        return (f"Solve the system x + y = {total} and {a}x + y = {weighted}.",
                f"Subtract the first equation from the second to eliminate y: {a - 1}x = {weighted - total}. Divide to get x = {x}. Then y = {total} − ({x}) = {y}.")
    if kind == 4:
        return (f"Solve |x {signed(-b)}| = {a}.",
                f"Set x − ({b}) equal to {a} or −{a}. Adding {b} gives x = {b + a} or x = {b - a}. Both values satisfy the original equation.")
    if kind == 5:
        n = rng.randint(8, 100)
        return (f"Find term {n} of an arithmetic sequence starting at {x} with common difference {b}.",
                f"Use aₙ = a₁ + (n − 1)d. Here aₙ = {x} + ({n} − 1)({b}) = {x + (n - 1) * b}.")
    if kind == 6:
        return (f"Factor x² {signed(x + y)}x {signed(x * y)}.",
                f"Find two numbers with sum {x + y} and product {x * y}. They are {x} and {y}, so the factors are (x {signed(x)})(x {signed(y)}).")
    if kind == 7:
        return (f"Find the inverse of f(x) = {a}x {signed(b)}.",
                f"Swap x and y: x = {a}y {signed(b)}. Subtract {b} and divide by {a}. The inverse is f⁻¹(x) = (x {signed(-b)}) / {a}.")
    if kind == 8:
        exponent = rng.randint(2, 11)
        return (f"Evaluate log base {a} of {a ** exponent}.",
                f"Find the power you raise {a} to in order to get {a ** exponent}. Because {a}^{exponent} = {a ** exponent}, the logarithm is {exponent}.")
    if kind == 9:
        n = rng.randint(4, 11)
        return (f"Find term {n} of a geometric sequence with first term {a} and ratio {c}.",
                f"Use aₙ = a₁r^(n − 1). Then a{n} = {a} × {c}^{n - 1} = {a * c ** (n - 1)}.")
    if kind == 10:
        rem = x * x + b * x + y
        return (f"Find the remainder when x² {signed(b)}x {signed(y)} is divided by x {signed(-x)}.",
                f"The divisor is x − ({x}). By the remainder theorem, plug in {x}: ({x})² + ({b})({x}) + ({y}) = {rem}.")
    p = rng.randint(1, 19) * 5
    n = rng.randint(2, 8)
    base = 10 * a + c
    return (f"A quantity starts at {base} and grows {p}% per period. What is it after {n} periods?",
            f"The multiplier is 1 + {p}/100 = {1 + p / 100:g}. After {n} periods, the quantity is {base}(1 + {p}/100)^{n}, approximately {base * (1 + p / 100) ** n:,.2f}.")


def write_rows(archive, path, pairs):
    with archive.open(path, "w", force_zip64=True) as member:
        for prompt, response in pairs:
            row = json.dumps({"prompt": prompt, "response": response}, ensure_ascii=False)
            member.write((row + "\n").encode("utf-8"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--records", type=int, default=1200, help="number of generated exercises")
    parser.add_argument("--seed", type=int, default=47)
    parser.add_argument("--rows-per-file", type=int, default=25000)
    args = parser.parse_args()
    if args.records < 0 or args.rows_per_file < 1:
        parser.error("records must be nonnegative and rows per file must be positive")
    rng = random.Random(args.seed)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(args.output, "w", ZIP_DEFLATED, allowZip64=True) as archive:
        write_rows(archive, "concepts.jsonl", CONCEPTS)
        for start in range(0, args.records, args.rows_per_file):
            end = min(start + args.rows_per_file, args.records)
            write_rows(archive, f"exercises-{start:09d}.jsonl", (exercise(i % 12, rng) for i in range(start, end)))
    print(f"{args.output}: {args.records + len(CONCEPTS):,} examples")


if __name__ == "__main__":
    main()
