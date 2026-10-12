/** Students (541) — generator STUDENT(i), i = 0…540 (Master Prompt §6.5). Names are fictional. */
import { last3, maskPhone, pad } from "../format";
import type { AllocationStatus, Student, TransportRoute } from "../types";

const FN = [
  "Aarav", "Vihaan", "Ananya", "Diya", "Ishaan", "Saanvi", "Arjun", "Kavya", "Reyansh", "Myra", "Aditya", "Ira",
  "Krishna", "Aadhya", "Sai", "Pari", "Rohan", "Navya", "Kabir", "Riya", "Dhruv", "Tara", "Arnav", "Meera", "Yash",
  "Anika", "Zoya", "Advik", "Siya", "Vivaan", "Nysa",
];
const LN = [
  "Reddy", "Rao", "Sharma", "Naidu", "Khan", "Varma", "Patel", "Iyer", "Goud", "Kumar", "Menon", "Shaikh", "Das",
  "Chowdary", "Joshi", "Pillai", "Mehta",
];

export const STUDENT_COUNT = 541;

export function seedStudents(routes: TransportRoute[]): Student[] {
  const out: Student[] = [];
  for (let i = 0; i < STUDENT_COUNT; i++) {
    const route = routes[i % 9];
    const stop = route.stops[Math.floor(i / 9) % route.stops.length];
    const roll = 1 + ((i * 13) % 42);
    const status: AllocationStatus = i <= 512 ? "Allocated" : i <= 526 ? "Pending" : "Waitlisted";
    const allocated = status === "Allocated";
    out.push({
      id: `ST${1000 + i}`,
      admission: `ADM/26/${pad(2140 + i * 3, 5)}`,
      name: `${FN[(i * 7) % 31]} ${LN[(i * 11) % 17]}`,
      cls: 1 + ((i * 7) % 10),
      section: "ABC"[(i * 5) % 3] as Student["section"],
      roll,
      routeCode: allocated ? route.code : null,
      stopId: allocated ? stop.id : null,
      busReg: allocated ? route.busReg : null,
      fare: allocated ? stop.fare : 0,
      status,
      parentName: "[Parent Name]",
      mobile: maskPhone("98", last3(100 + roll * 7)),
      attendance30d: 88 + (roll % 12),
    });
  }
  return out;
}
