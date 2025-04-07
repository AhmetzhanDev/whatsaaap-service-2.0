import mongoose, { Document, Schema } from 'mongoose';
import { IUser } from './User';

export interface IWhatsAppAccount extends Document {
  userId: IUser['_id'];
  companyName: string;
  avgResponseTime: number;
  secondTouch: boolean;
  phoneNumber: string;
  sessionData: string;
  sessionPath: string;
  createdAt: Date;
}

const whatsAppAccountSchema = new Schema<IWhatsAppAccount>({
  userId: { 
    type: Schema.Types.ObjectId, 
    ref: 'User',
    required: true 
  },
  companyName: { 
    type: String, 
    required: true 
  },
  avgResponseTime: { 
    type: Number, 
    required: true 
  },
  secondTouch: { 
    type: Boolean, 
    required: true, 
    default: false 
  },
  phoneNumber: { 
    type: String, 
    required: true 
  },
  sessionData: { 
    type: String, 
    required: true,
    validate: {
      validator: function(v: string) {
        try {
          JSON.parse(v);
          return true;
        } catch (e) {
          return false;
        }
      },
      message: 'sessionData должен быть валидным JSON'
    }
  },
  sessionPath: { 
    type: String, 
    required: true,
    validate: {
      validator: function(v: string) {
        return v.startsWith(process.cwd());
      },
      message: 'sessionPath должен быть абсолютным путем'
    }
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

export const WhatsAppAccountModel = mongoose.model<IWhatsAppAccount>('WhatsAppAccount', whatsAppAccountSchema);