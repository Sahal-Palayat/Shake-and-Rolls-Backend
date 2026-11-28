import { Role } from '../common/enums';
import { OrderDto } from './dto/order.dto';
import { OrderDocument } from './schemas/order.schema';

/** Staff see who made each change; customers do not. */
export function toOrderDto(o: OrderDocument, viewerRole: Role): OrderDto {
  const showActors = viewerRole !== Role.Customer;
  return {
    id: o.id as string,
    orderNumber: o.orderNumber,
    status: o.status,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod,
    cashCollectedPaise: o.cashCollectedPaise,
    lines: o.lines.map((l) => ({
      menuItemId: l.menuItemId.toHexString(),
      name: l.name,
      isVeg: l.isVeg,
      unitPricePaise: l.unitPricePaise,
      options: l.options.map((x) => ({
        optionId: x.optionId.toHexString(),
        groupName: x.groupName,
        name: x.name,
        priceDeltaPaise: x.priceDeltaPaise,
      })),
      quantity: l.quantity,
      lineTotalPaise: l.lineTotalPaise,
      note: l.note,
      comboRef: l.comboRef,
      comboName: l.comboName,
    })),
    fulfillment: o.fulfillment,
    subtotalPaise: o.subtotalPaise,
    comboSavingsPaise: o.comboSavingsPaise ?? 0,
    combos: (o.combos ?? []).map((c) => ({
      comboId: c.comboId.toHexString(),
      comboRef: c.comboRef,
      name: c.name,
      discountPercent: c.discountPercent,
      quantity: c.quantity,
      itemsPaise: c.itemsPaise,
      savingsPaise: c.savingsPaise,
    })),
    deliveryFeePaise: o.deliveryFeePaise,
    totalPaise: o.totalPaise,
    contactName: o.contactName,
    contactPhone: o.contactPhone,
    deliveryAddress: o.deliveryAddress && {
      // GeoJSON is [lng, lat]
      latitude: o.deliveryAddress.location?.coordinates?.[1],
      longitude: o.deliveryAddress.location?.coordinates?.[0],
      locationSource: o.deliveryAddress.locationSource,
      placeId: o.deliveryAddress.placeId,
      formattedAddress: o.deliveryAddress.formattedAddress,
      houseName: o.deliveryAddress.houseName,
      buildingName: o.deliveryAddress.buildingName,
      floor: o.deliveryAddress.floor,
      line1: o.deliveryAddress.line1,
      area: o.deliveryAddress.area,
      landmark: o.deliveryAddress.landmark,
      pincode: o.deliveryAddress.pincode,
    },
    customerNote: o.customerNote,
    riderId: o.riderId?.toHexString(),
    statusLog: o.statusLog.map((e) => ({
      from: e.from ?? null,
      to: e.to,
      byRole: e.byRole,
      ...(showActors && { byUserId: e.byUserId.toHexString() }),
      at: e.at.toISOString(),
      reason: e.reason,
    })),
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}
